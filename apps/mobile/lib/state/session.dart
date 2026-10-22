import 'package:flutter/foundation.dart';

import '../api/api.dart';
import '../api/models.dart';
import '../auth/identity.dart';
import '../uploads/upload_queue.dart';
import 'push.dart';

enum SessionStatus { loading, signedIn, signedOut }

/// Who's signed in, plus the "me" payload (user, self person, pending invites).
///
/// Signing in goes through the shared identity server; InFrame then issues its
/// own access and refresh tokens, exactly as it always has.
class Session extends ChangeNotifier {
  Session({IdentityClient? identity}) : identity = identity ?? AppAuthIdentityClient();

  final IdentityClient identity;
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

  /// Signs in at the identity server, then trades its ID token for an InFrame
  /// session. False when the person backed out of the browser.
  /// Throws [IdentityException] or [ApiException] with a message to show.
  Future<bool> signIn() async {
    final result = await identity.signIn();
    if (result == null) return false;
    final body = await api.post<Map<String, dynamic>>('/api/auth/oidc/mobile', {
      'idToken': result.idToken,
      'nonce': result.nonce,
    });
    await api.adopt(body);
    await api.saveIdTokenHint(result.idToken);
    status = SessionStatus.signedIn;
    await reloadMe();
    notifyListeners();
    return true;
  }

  /// Ends the InFrame session here, then the identity server's (so "Sign in" asks again).
  Future<void> signOut() async {
    // While still signed in: this phone stops getting the account's notifications.
    await Push.instance.unregister();
    try {
      await api.post<dynamic>('/api/auth/logout');
    } on ApiException {
      // signing out locally either way
    }
    final idTokenHint = await api.idTokenHint;
    await api.clearSession();
    await uploads.reset();
    me = null;
    status = SessionStatus.signedOut;
    notifyListeners();
    await identity.signOut(idTokenHint: idTokenHint);
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
