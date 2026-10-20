import 'package:flutter/foundation.dart';

import '../api/api.dart';
import '../api/models.dart';
import '../uploads/upload_queue.dart';

enum SessionStatus { loading, signedIn, signedOut }

/// Who's signed in, plus the "me" payload (user, self person, pending invites).
class Session extends ChangeNotifier {
  SessionStatus status = SessionStatus.loading;
  Me? me;

  Future<void> start() async {
    await api.load();
    api.onSignedOut = _signedOutRemotely;
    if (await api.hasSession && await api.refresh()) {
      status = SessionStatus.signedIn;
      await reloadMe();
    } else {
      status = SessionStatus.signedOut;
    }
    notifyListeners();
  }

  Future<void> reloadMe() async {
    try {
      me = Me(await api.get<Map<String, dynamic>>('/api/me'));
      notifyListeners();
    } on ApiException {
      // keep what we have
    }
  }

  Future<void> signIn(String email, String password) async {
    final body = await api.post<Map<String, dynamic>>('/api/auth/login', {'email': email, 'password': password});
    await _adopt(body);
  }

  Future<void> signUp(String name, String email, String password) async {
    final body = await api.post<Map<String, dynamic>>('/api/auth/signup', {'name': name, 'email': email, 'password': password});
    await _adopt(body);
  }

  Future<void> _adopt(Map<String, dynamic> body) async {
    await api.adopt(body);
    status = SessionStatus.signedIn;
    await reloadMe();
    notifyListeners();
  }

  /// After a password change: this device continues with the new tokens.
  Future<void> adoptTokens(Map<String, dynamic> body) => api.adopt(body);

  Future<void> signOut() async {
    try {
      await api.post<dynamic>('/api/auth/logout');
    } on ApiException {
      // signing out locally either way
    }
    await api.clearSession();
    await uploads.reset();
    me = null;
    status = SessionStatus.signedOut;
    notifyListeners();
  }

  void _signedOutRemotely() {
    if (status != SessionStatus.signedIn) return;
    api.clearSession();
    uploads.reset();
    me = null;
    status = SessionStatus.signedOut;
    notifyListeners();
  }
}
