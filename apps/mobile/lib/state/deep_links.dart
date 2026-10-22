import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';

import '../screens/event_screen.dart';

/// The app's navigator, for opening screens from outside the widget tree (links, notifications).
final appNavigatorKey = GlobalKey<NavigatorState>();

/// The event a link points at, or null for a link InFrame doesn't open.
///
/// ```text
/// inframe://app/events/ID · …/events/ID (the website's event page, an App Link) · …/events/ID/upload
/// ```
String? eventIdFromLink(Uri uri) {
  final segments = uri.pathSegments.where((s) => s.isNotEmpty).toList();
  if (uri.scheme == 'inframe') {
    if (uri.host != 'app' || segments.length < 2 || segments.first != 'events') return null;
    return segments[1];
  }
  if (uri.scheme != 'https' && uri.scheme != 'http') return null;
  if (segments.length < 2 || segments.first != 'events' || segments[1] == 'new') return null;
  return segments[1];
}

/// Opens incoming event links: from Trippin (`inframe://app/events/ID`, which works whether or not
/// the App Link is verified), from the website's event pages (verified against
/// https://in-frame.duckdns.org/.well-known/assetlinks.json) and from notifications. A link that
/// arrives signed out waits until the home screen is up.
class DeepLinks {
  DeepLinks._();
  static final DeepLinks instance = DeepLinks._();

  StreamSubscription<Uri>? _sub;
  String? _pendingEvent;
  bool _ready = false;

  /// Listens for links: the one that launched the app, and any while it runs.
  void start() {
    if (_sub != null) return;
    try {
      _sub = AppLinks().uriLinkStream.listen(open, onError: (_) {});
    } catch (_) {
      // No platform support (tests, desktop): nothing to listen to.
    }
  }

  /// Opens what [uri] points at, now or once signed in.
  void open(Uri uri) {
    final event = eventIdFromLink(uri);
    if (event == null) return;
    _pendingEvent = event;
    _flush();
  }

  /// The home screen is up (signed in): open anything waiting.
  void attach() {
    _ready = true;
    _flush();
  }

  /// Signed out: links wait again.
  void detach() => _ready = false;

  void _flush() {
    final event = _pendingEvent;
    final navigator = appNavigatorKey.currentState;
    if (event == null || !_ready || navigator == null) return;
    _pendingEvent = null;
    navigator.push(MaterialPageRoute(builder: (_) => EventScreen(eventId: event)));
  }
}
