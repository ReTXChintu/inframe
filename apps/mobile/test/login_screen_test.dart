import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inframe/api/api.dart';
import 'package:inframe/auth/identity.dart';
import 'package:inframe/screens/auth_screens.dart';
import 'package:inframe/state/session.dart';
import 'package:provider/provider.dart';

/// Stands in for AppAuth: what the identity server would hand back.
class FakeIdentity implements IdentityClient {
  FakeIdentity(this.result);

  /// Returns a sign-in, null (cancelled) or throws.
  final Future<IdentitySignIn?> Function() result;
  int signIns = 0;

  @override
  Future<IdentitySignIn?> signIn() {
    signIns++;
    return result();
  }

  @override
  Future<void> signOut({String? idTokenHint}) async {}
}

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

const _user = {'id': 'u-1', 'email': 'alice@example.com', 'name': 'Alice', 'isAdmin': false, 'createdAt': '2026-10-21T00:00:00Z'};

Future<Session> _pumpLogin(WidgetTester tester, IdentityClient identity) async {
  final session = Session(identity: identity)..status = SessionStatus.signedOut;
  await tester.pumpWidget(
    ChangeNotifierProvider<Session>.value(value: session, child: const MaterialApp(home: LoginScreen())),
  );
  return session;
}

/// Tap "Sign in" and let the (fake) identity server and API answer.
Future<void> _tapSignIn(WidgetTester tester) async {
  // Real async: the API client and secure storage complete on real futures and timers.
  await tester.runAsync(() async {
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await Future<void>.delayed(const Duration(milliseconds: 200));
  });
  await tester.pump();
}

void main() {
  const storage = FlutterSecureStorage();
  late FakeServer server;

  void useServer(Map<String, (int, Map<String, dynamic>)> routes) {
    server = FakeServer(routes);
    api.httpClientAdapter = server;
  }

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    await api.clearSession();
    useServer({});
  });

  testWidgets('shows one sign-in button and no password fields', (tester) async {
    await _pumpLogin(tester, FakeIdentity(() async => null));
    expect(find.widgetWithText(FilledButton, 'Sign in'), findsOneWidget);
    expect(find.textContaining('One account for InFrame, SpendLog and Trippin'), findsOneWidget);
    expect(find.byType(TextField), findsNothing);
    expect(find.text('Create an account'), findsNothing);
    expect(find.text('Forgot password?'), findsNothing);
  });

  testWidgets('signing in posts the ID token and keeps the refresh token', (tester) async {
    useServer({
      'POST /api/auth/oidc/mobile': (201, {'accessToken': 'access-1', 'refreshToken': 'refresh-1', 'user': _user, 'created': true}),
      'GET /api/me': (200, {'user': _user, 'self': null, 'pendingInvites': 0}),
    });
    final identity = FakeIdentity(() async => const IdentitySignIn(idToken: 'id-token-1', nonce: 'nonce-1'));
    final session = await _pumpLogin(tester, identity);

    await _tapSignIn(tester);

    expect(identity.signIns, 1);
    final exchange = server.requests.firstWhere((r) => r.uri.path == '/api/auth/oidc/mobile');
    expect(exchange.method, 'POST');
    expect(exchange.data, {'idToken': 'id-token-1', 'nonce': 'nonce-1'});
    expect(exchange.headers['x-inframe-client'], 'mobile');

    expect(session.status, SessionStatus.signedIn);
    expect(session.me?.user.email, 'alice@example.com');
    expect(await storage.read(key: 'inframe.refresh'), 'refresh-1');
    expect(await storage.read(key: 'inframe.idToken'), 'id-token-1');
    // The next API call carries InFrame's own access token, not the identity server's.
    expect(server.requests.last.headers['Authorization'], 'Bearer access-1');
  });

  testWidgets('a refusal from InFrame is shown and nothing is kept', (tester) async {
    useServer({
      'POST /api/auth/oidc/mobile': (
        403,
        {'code': 'email_unverified', 'message': 'Verify your email address with your account first, then sign in again.'},
      ),
    });
    final session = await _pumpLogin(
      tester,
      FakeIdentity(() async => const IdentitySignIn(idToken: 'id-token-2', nonce: 'nonce-2')),
    );

    await _tapSignIn(tester);

    expect(find.text('Verify your email address with your account first, then sign in again.'), findsOneWidget);
    expect(session.status, SessionStatus.signedOut);
    expect(await storage.read(key: 'inframe.refresh'), isNull);
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Sign in')).onPressed, isNotNull);
  });

  testWidgets('a failure at the identity server is shown', (tester) async {
    final session = await _pumpLogin(tester, FakeIdentity(() async => throw IdentityException("Couldn't sign in: network error")));

    await _tapSignIn(tester);

    expect(find.text("Couldn't sign in: network error"), findsOneWidget);
    expect(session.status, SessionStatus.signedOut);
    expect(server.requests, isEmpty);
  });

  testWidgets('backing out of the browser is not an error', (tester) async {
    final session = await _pumpLogin(tester, FakeIdentity(() async => null));

    await _tapSignIn(tester);

    expect(session.status, SessionStatus.signedOut);
    expect(server.requests, isEmpty);
    expect(find.textContaining("Couldn't"), findsNothing);
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Sign in')).onPressed, isNotNull);
  });

  test('a build without OIDC_ISSUER says sign-in is not set up', () async {
    expect(
      () => AppAuthIdentityClient().signIn(),
      throwsA(isA<IdentityException>().having((e) => e.message, 'message', contains("isn't set up"))),
    );
  });
}
