import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';

import '../api/api.dart';
import 'deep_links.dart';

/// For notifications that arrive while the app is open: shown as a snackbar.
final pushMessengerKey = GlobalKey<ScaffoldMessengerState>();

/// Where a notification opens: its `link` (inframe://app/events/ID), else its event, else nothing
/// (just the app). An invite opens the app, where it's waiting: the event isn't theirs until accepted.
Uri? pushLink(Map<String, dynamic> data) {
  if (data['type'] == 'INVITE') return null;
  final link = data['link'];
  if (link is String) {
    final uri = Uri.tryParse(link);
    if (uri != null && eventIdFromLink(uri) != null) return uri;
  }
  final eventId = data['eventId'];
  if (eventId is String && eventId.isNotEmpty) return Uri(scheme: 'inframe', host: 'app', pathSegments: ['events', eventId]);
  return null;
}

/// Push notifications (someone joined, added from Trippin, invites, new photos), through Firebase.
///
/// Without the Firebase config in the build (google-services.json) this does nothing. After
/// sign-in it asks for permission and gives the server this phone's token; at sign-out the server
/// forgets it. A tap opens the event, through the same route as an event link.
class Push {
  Push._();
  static final Push instance = Push._();

  bool _ready = false;
  String? _registered;

  /// Sets Firebase up; false when this build has no Firebase config.
  Future<bool> start() async {
    if (_ready) return true;
    try {
      await Firebase.initializeApp();
    } catch (_) {
      return false;
    }
    try {
      FirebaseMessaging.onMessageOpenedApp.listen((m) => _open(m.data));
      FirebaseMessaging.onMessage.listen(_showWhileOpen);
      FirebaseMessaging.instance.onTokenRefresh.listen((token) {
        if (_registered != null) unawaited(_upload(token).catchError((_) {}));
      });
      final initial = await FirebaseMessaging.instance.getInitialMessage();
      if (initial != null) _open(initial.data);
      _ready = true;
    } catch (_) {
      return false;
    }
    return true;
  }

  /// Signed in: ask to show notifications, and tell the server where to send them.
  Future<void> register() async {
    if (!await start()) return;
    try {
      await FirebaseMessaging.instance.requestPermission();
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null) await _upload(token);
    } catch (_) {
      // Offline or refused: the next sign-in or launch tries again.
    }
  }

  Future<void> _upload(String token) async {
    if (token == _registered) return;
    await api.post<dynamic>('/api/me/devices', {'token': token, 'platform': 'android'});
    _registered = token;
  }

  /// Signing out (while still signed in): this phone stops getting the account's notifications.
  Future<void> unregister() async {
    if (!_ready) return;
    try {
      final token = _registered ?? await FirebaseMessaging.instance.getToken();
      if (token != null) await api.delete<dynamic>('/api/me/devices', {'token': token});
      await FirebaseMessaging.instance.deleteToken();
    } catch (_) {
      // Offline: the server drops the token the next time Firebase says it's gone.
    }
    _registered = null;
  }

  void _open(Map<String, dynamic> data) {
    final link = pushLink(data);
    if (link != null) DeepLinks.instance.open(link);
  }

  void _showWhileOpen(RemoteMessage message) {
    final title = message.notification?.title;
    if (title == null) return;
    final link = pushLink(message.data);
    pushMessengerKey.currentState?.showSnackBar(SnackBar(
      content: Text(title),
      action: link == null ? null : SnackBarAction(label: 'Open', onPressed: () => DeepLinks.instance.open(link)),
    ));
  }
}
