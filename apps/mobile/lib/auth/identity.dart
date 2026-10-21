import 'dart:convert';
import 'dart:math';

import 'package:flutter/services.dart';
import 'package:flutter_appauth/flutter_appauth.dart';

import '../config.dart';

/// What the identity server hands back once someone has signed in.
class IdentitySignIn {
  const IdentitySignIn({required this.idToken, required this.nonce});

  /// The OpenID Connect ID token (audience `inframe-mobile`), sent to InFrame once.
  final String idToken;

  /// The nonce the sign-in was started with; InFrame checks the token carries it.
  final String nonce;
}

/// Signing in at the identity server didn't work (not cancelled: that's `null`).
class IdentityException implements Exception {
  IdentityException(this.message);
  final String message;

  @override
  String toString() => message;
}

/// The OpenID Connect identity server shared by InFrame, SpendLog and Trippin.
///
/// An interface so tests can stand in for the browser-based AppAuth flow.
abstract class IdentityClient {
  /// Runs the sign-in (code flow with PKCE) in the browser. Null when the person backed out.
  Future<IdentitySignIn?> signIn();

  /// Ends the identity server's browser session too, so "Sign in" asks again. Best effort.
  Future<void> signOut({String? idTokenHint});
}

/// The real thing: AppAuth through `flutter_appauth`.
class AppAuthIdentityClient implements IdentityClient {
  AppAuthIdentityClient({FlutterAppAuth? appAuth}) : _appAuth = appAuth ?? const FlutterAppAuth();

  final FlutterAppAuth _appAuth;

  @override
  Future<IdentitySignIn?> signIn() async {
    if (oidcIssuer.isEmpty) {
      throw IdentityException("Sign-in isn't set up in this build of the app (no OIDC_ISSUER).");
    }
    final nonce = _randomValue();
    try {
      final res = await _appAuth.authorizeAndExchangeCode(
        AuthorizationTokenRequest(
          oidcClientId,
          oidcRedirectUrl,
          issuer: oidcIssuer,
          scopes: oidcScopes,
          nonce: nonce,
        ),
      );
      final idToken = res.idToken;
      if (idToken == null || idToken.isEmpty) {
        throw IdentityException("The sign-in service didn't say who you are. Try again.");
      }
      return IdentitySignIn(idToken: idToken, nonce: nonce);
    } on FlutterAppAuthUserCancelledException {
      return null;
    } on PlatformException catch (e) {
      throw IdentityException("Couldn't sign in: ${e.message ?? e.code}");
    }
  }

  @override
  Future<void> signOut({String? idTokenHint}) async {
    if (oidcIssuer.isEmpty) return;
    try {
      await _appAuth.endSession(
        EndSessionRequest(idTokenHint: idTokenHint, postLogoutRedirectUrl: oidcRedirectUrl, issuer: oidcIssuer),
      );
    } on PlatformException {
      // Already signed out locally; the identity server's session just lives on.
    }
  }

  static String _randomValue() {
    final random = Random.secure();
    return base64UrlEncode(List<int>.generate(24, (_) => random.nextInt(256))).replaceAll('=', '');
  }
}
