import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inframe/api/api.dart';
import 'package:inframe/api/models.dart';
import 'package:inframe/screens/connect_storage_screen.dart';
import 'package:inframe/widgets/trippin.dart';

/// Answers the app's HTTP requests instead of an InFrame server.
class FakeServer implements HttpClientAdapter {
  FakeServer(this.routes);

  final Map<String, (int, Map<String, dynamic>)> routes;
  final List<RequestOptions> requests = [];

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    requests.add(options);
    final route = routes['${options.method} ${options.uri.path}'] ?? (404, {'code': 'not_found', 'message': 'Not found.'});
    return ResponseBody.fromString(
      jsonEncode(route.$2),
      route.$1,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

Map<String, dynamic> _event({Map<String, dynamic>? external, bool pending = false, bool isOwner = true}) => {
      'id': 'e-1',
      'name': 'Goa',
      'kind': 'trip',
      'isOwner': isOwner,
      'isHost': isOwner,
      'can': {'viewAll': true, 'upload': !pending, 'faceSearch': true},
      'storage': {'connected': !pending, 'pending': pending},
      'external': external,
    };

Widget _app(Widget child) => MaterialApp(home: Scaffold(body: Center(child: child)));

void main() {
  group('models', () {
    test('a Trippin-linked, storage-pending event', () {
      final e = EventDetail(_event(pending: true, external: {'source': 'trippin', 'url': 'https://trippin.test/trips/t-1', 'linked': true}));
      expect(e.storagePending, isTrue);
      expect(e.storageConnected, isFalse);
      expect(e.canUpload, isFalse);
      expect(e.external?.isTrippin, isTrue);
      expect(e.external?.linked, isTrue);
      expect(e.external?.url, 'https://trippin.test/trips/t-1');
    });

    test('older servers without the fields read as a plain event', () {
      final e = EventDetail({'id': 'e-1', 'storage': {'connected': true}});
      expect(e.storagePending, isFalse);
      expect(e.external, isNull);
      final s = EventSummary({'id': 'e-1'});
      expect(s.storagePending, isFalse);
      expect(s.external, isNull);
    });

    test('event list items', () {
      final s = EventSummary({'id': 'e-1', 'storagePending': true, 'external': {'source': 'trippin', 'url': null, 'linked': false}});
      expect(s.storagePending, isTrue);
      expect(s.external?.linked, isFalse);
      expect(s.external?.url, isNull);
    });
  });

  group('Trippin chip', () {
    testWidgets('linked: "Planned in Trippin", tappable', (tester) async {
      await tester.pumpWidget(_app(TrippinChip(ExternalLink({'source': 'trippin', 'url': 'https://trippin.test/trips/t-1', 'linked': true}))));
      expect(find.text('Planned in Trippin'), findsOneWidget);
      expect(find.byType(InkWell), findsOneWidget);
    });

    testWidgets('unlinked: "Was linked to Trippin", not tappable', (tester) async {
      await tester.pumpWidget(_app(TrippinChip(ExternalLink({'source': 'trippin', 'url': 'https://trippin.test/trips/t-1', 'linked': false}))));
      expect(find.text('Was linked to Trippin'), findsOneWidget);
      expect(find.text('Planned in Trippin'), findsNothing);
      expect(find.byType(InkWell), findsNothing);
    });
  });

  group('storage pending', () {
    testWidgets('the owner is asked to connect a folder', (tester) async {
      var tapped = 0;
      await tester.pumpWidget(_app(StoragePendingBanner(isOwner: true, onConnect: () => tapped++)));
      expect(find.text('Connect a folder to start adding photos'), findsOneWidget);
      await tester.tap(find.text('Connect a folder'));
      expect(tapped, 1);
    });

    testWidgets('members are told photos come once the owner connects one', (tester) async {
      await tester.pumpWidget(_app(StoragePendingBanner(isOwner: false, onConnect: () {})));
      expect(find.text('Photos will appear once the owner connects a folder.'), findsOneWidget);
      expect(find.text('Connect a folder'), findsNothing);
    });
  });

  group('connecting a folder later', () {
    late FakeServer server;

    setUp(() async {
      FlutterSecureStorage.setMockInitialValues({});
      await api.clearSession();
    });

    testWidgets('puts the chosen account and a new folder on the event', (tester) async {
      server = FakeServer({
        'GET /api/storage/connections': (
          200,
          {
            'connections': [
              {'id': 'c-1', 'provider': 'mega', 'accountLabel': 'alice@example.com', 'status': 'ok'},
            ],
          },
        ),
        'PUT /api/events/e-1/storage': (200, {'event': _event(), 'removedPhotos': 0}),
      });
      api.httpClientAdapter = server;
      bool? result;
      await tester.pumpWidget(MaterialApp(
        home: Builder(
          builder: (context) => TextButton(
            onPressed: () async => result = await Navigator.push<bool>(
              context,
              MaterialPageRoute(builder: (_) => ConnectStorageScreen(event: EventDetail(_event(pending: true)))),
            ),
            child: const Text('open'),
          ),
        ),
      ));
      await tester.tap(find.text('open'));
      await tester.pump(); // builds the screen, which asks for the connections
      // Real async: the API client completes on real futures.
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 200)));
      await tester.pump(const Duration(seconds: 1));
      await tester.pumpAndSettle();

      expect(find.text('alice@example.com'), findsOneWidget);
      expect(find.textContaining('InFrame · Goa'), findsOneWidget);

      await tester.runAsync(() async {
        await tester.tap(find.widgetWithText(FilledButton, 'Connect folder'));
        await Future<void>.delayed(const Duration(milliseconds: 200));
      });
      await tester.pumpAndSettle();

      final put = server.requests.firstWhere((r) => r.method == 'PUT');
      expect(put.uri.path, '/api/events/e-1/storage');
      expect(put.data, {'connectionId': 'c-1', 'folder': null});
      expect(result, isTrue);
    });
  });
}
