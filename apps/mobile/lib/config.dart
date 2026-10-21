/// Build-time default for the InFrame server. CI passes the production URL:
/// `flutter build apk --dart-define=API_BASE_URL=http://host:port`.
/// People can still point the app at another server from the sign-in screen.
const String defaultServerUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://187.127.179.114:50010',
);

/// The OpenID Connect identity server shared by InFrame, SpendLog and Trippin.
/// CI passes it like the server URL: `--dart-define=OIDC_ISSUER=https://id-x.duckdns.org:50011`.
/// Empty means this build can't sign anyone in (the sign-in screen says so).
const String oidcIssuer = String.fromEnvironment('OIDC_ISSUER');

/// The app's public (PKCE) client on the identity server.
const String oidcClientId = 'inframe-mobile';

/// Where the identity server sends the browser back to. The scheme is the
/// Android applicationId, registered for AppAuth through the
/// `appAuthRedirectScheme` manifest placeholder in android/app/build.gradle.kts.
const String oidcRedirectUrl = 'app.inframe.android:/oauth2redirect';

const List<String> oidcScopes = ['openid', 'email', 'profile', 'offline_access'];

/// Normalise what someone typed as a server address.
String normalizeServerUrl(String input) {
  var url = input.trim();
  if (url.isEmpty) return defaultServerUrl;
  if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'http://$url';
  return url.replaceAll(RegExp(r'/+$'), '');
}
