/// Build-time default for the InFrame server. CI passes the production URL:
/// `flutter build apk --dart-define=API_BASE_URL=http://host:port`.
/// People can still point the app at another server from the sign-in screen.
const String defaultServerUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://187.127.179.114:50010',
);

/// Normalise what someone typed as a server address.
String normalizeServerUrl(String input) {
  var url = input.trim();
  if (url.isEmpty) return defaultServerUrl;
  if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'http://$url';
  return url.replaceAll(RegExp(r'/+$'), '');
}
