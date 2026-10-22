import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inframe/api/models.dart';
import 'package:inframe/widgets/guest_limits.dart';

const gb = 1024 * 1024 * 1024;

Widget _app(Widget child) => MaterialApp(home: Scaffold(body: Center(child: child)));

class _Popped {
  Map<String, dynamic>? result;
  bool closed = false;
}

void main() {
  group('models', () {
    test('a guest reads what is left of the allowance', () {
      final a = GuestAllowance({'maxItems': 300, 'maxBytes': 2 * gb, 'usedItems': 12, 'usedBytes': gb});
      expect(a.limited, isTrue);
      expect(a.itemsLeft, 288);
      expect(a.bytesLeft, gb);
      expect(a.exhausted, isFalse);
    });

    test('used up on either side counts as exhausted, never below zero', () {
      expect(GuestAllowance({'maxItems': 1, 'maxBytes': null, 'usedItems': 3, 'usedBytes': 0}).itemsLeft, 0);
      expect(GuestAllowance({'maxItems': 1, 'maxBytes': null, 'usedItems': 3, 'usedBytes': 0}).exhausted, isTrue);
      expect(GuestAllowance({'maxItems': null, 'maxBytes': 10, 'usedItems': 0, 'usedBytes': 10}).exhausted, isTrue);
      final free = GuestAllowance({'maxItems': null, 'maxBytes': null, 'usedItems': 5, 'usedBytes': 5});
      expect(free.limited, isFalse);
      expect(free.exhausted, isFalse);
      expect(allowanceText(free), isNull);
    });

    test('the event carries the limits, and older servers read as no limit', () {
      final e = EventDetail({
        'id': 'e-1',
        'settings': {'guestMaxItems': 300, 'guestMaxBytes': 2 * gb},
        'guestAllowance': {'maxItems': 300, 'maxBytes': 2 * gb, 'usedItems': 0, 'usedBytes': 0},
      });
      expect(e.guestMaxItems, 300);
      expect(e.guestMaxBytes, 2 * gb);
      expect(e.guestAllowance?.itemsLeft, 300);
      final old = EventDetail({'id': 'e-1', 'settings': {'joinEnabled': true}});
      expect(old.guestMaxItems, isNull);
      expect(old.guestAllowance, isNull);
      expect(guestLimitLabel(old.guestMaxItems, old.guestMaxBytes), 'No limit');
    });

    test('labels', () {
      expect(guestLimitLabel(300, 2 * gb), '300 files · 2.0 GB');
      expect(guestLimitLabel(1, null), '1 file');
      expect(guestLimitLabel(null, 512 * 1024 * 1024), '512 MB');
      expect(allowanceText(GuestAllowance({'maxItems': 300, 'maxBytes': 2 * gb, 'usedItems': 299, 'usedBytes': gb})), 'You can add 1 more file · 1.0 GB left.');
      expect(allowanceText(GuestAllowance({'maxItems': 300, 'maxBytes': null, 'usedItems': 300, 'usedBytes': 0})), "You've reached what this event allows each guest to add.");
    });
  });

  group('allowance card', () {
    testWidgets('room left: a quiet note', (tester) async {
      await tester.pumpWidget(_app(GuestAllowanceCard(GuestAllowance({'maxItems': 300, 'maxBytes': 2 * gb, 'usedItems': 10, 'usedBytes': 0}))));
      expect(find.text('You can add 290 more files · 2.0 GB left.'), findsOneWidget);
      expect(find.textContaining('Ask them'), findsNothing);
    });

    testWidgets('used up: a warning that names who decides', (tester) async {
      await tester.pumpWidget(_app(GuestAllowanceCard(GuestAllowance({'maxItems': 10, 'maxBytes': null, 'usedItems': 10, 'usedBytes': 0}))));
      expect(find.text("You've reached what this event allows each guest to add."), findsOneWidget);
      expect(find.textContaining('The host sets how much each guest can add.'), findsOneWidget);
    });

    testWidgets('no limit: nothing shown', (tester) async {
      await tester.pumpWidget(_app(GuestAllowanceCard(GuestAllowance({'maxItems': null, 'maxBytes': null, 'usedItems': 0, 'usedBytes': 0}))));
      expect(find.byType(Text), findsNothing);
    });
  });

  group('the owner\'s limit sheet', () {
    /// Opens the sheet from a button; what it pops with lands in `result`.
    Future<_Popped> open(WidgetTester tester, {int? maxItems, int? maxBytes}) async {
      final popped = _Popped();
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () async {
                popped.result = await showGuestLimitSheet(context, maxItems: maxItems, maxBytes: maxBytes);
                popped.closed = true;
              },
              child: const Text('open'),
            ),
          ),
        ),
      ));
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      return popped;
    }

    testWidgets('starts from the current limits and saves changed numbers', (tester) async {
      final popped = await open(tester, maxItems: 300, maxBytes: 2 * gb);
      expect(find.text('300'), findsOneWidget);
      expect(find.text('2'), findsOneWidget);
      await tester.enterText(find.byKey(const ValueKey('limit-items')), '50');
      await tester.enterText(find.byKey(const ValueKey('limit-gb')), '0.5');
      await tester.pumpAndSettle();
      await tester.tap(find.text('Save limit'));
      await tester.pumpAndSettle();
      expect(popped.closed, isTrue);
      expect(popped.result, {'guestMaxItems': 50, 'guestMaxBytes': 512 * 1024 * 1024});
    });

    testWidgets('switching a side off saves null (no limit) for it', (tester) async {
      final popped = await open(tester, maxItems: 300, maxBytes: 2 * gb);
      await tester.tap(find.byKey(const ValueKey('limit-bytes-on')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('limit-gb')), findsNothing);
      await tester.tap(find.text('Save limit'));
      await tester.pumpAndSettle();
      expect(popped.closed, isTrue);
      expect(popped.result, {'guestMaxItems': 300, 'guestMaxBytes': null});
    });

    testWidgets('an empty or zero number cannot be saved', (tester) async {
      await open(tester, maxItems: 300, maxBytes: null);
      await tester.enterText(find.byKey(const ValueKey('limit-items')), '0');
      await tester.pumpAndSettle();
      expect(find.text('At least 1.'), findsOneWidget);
      final button = tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Save limit'));
      expect(button.onPressed, isNull);
    });
  });
}
