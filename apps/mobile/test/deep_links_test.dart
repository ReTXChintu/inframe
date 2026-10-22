// Event links into InFrame: from Trippin, the website (App Links) and notifications.
import 'package:flutter_test/flutter_test.dart';
import 'package:inframe/state/deep_links.dart';
import 'package:inframe/state/push.dart';

void main() {
  test('an event link in every form it arrives in', () {
    for (final link in [
      'inframe://app/events/e-1',
      'https://in-frame.duckdns.org/events/e-1',
      'https://in-frame.duckdns.org:50010/events/e-1/upload',
    ]) {
      expect(eventIdFromLink(Uri.parse(link)), 'e-1', reason: link);
    }
  });

  test('links InFrame does not open', () {
    for (final link in [
      'inframe://other/events/e-1',
      'inframe://app/settings',
      'https://in-frame.duckdns.org/events/new',
      'https://in-frame.duckdns.org/events',
      'https://in-frame.duckdns.org/inframe.apk',
      'spendlog://app/groups/g1',
    ]) {
      expect(eventIdFromLink(Uri.parse(link)), isNull, reason: link);
    }
  });

  test('a notification opens its event', () {
    expect(pushLink({'type': 'PHOTOS_ADDED', 'eventId': 'e-1', 'link': 'inframe://app/events/e-1'}).toString(), 'inframe://app/events/e-1');
    expect(pushLink({'type': 'JOINED', 'eventId': 'e-2'}).toString(), 'inframe://app/events/e-2');
    expect(pushLink({'type': 'INVITE', 'eventId': 'e-3'}), isNull, reason: 'not theirs until accepted');
    expect(pushLink({'type': 'X', 'link': 'https://evil.example/'}), isNull);
    expect(pushLink({'type': 'X'}), isNull);
  });
}
