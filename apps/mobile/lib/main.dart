import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import 'screens/auth_screens.dart';
import 'screens/home.dart';
import 'state/deep_links.dart';
import 'state/push.dart';
import 'state/session.dart';
import 'theme.dart';
import 'uploads/upload_queue.dart';
import 'widgets/common.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  // IBM Plex ships in the app under the SIL Open Font License; list it on the licences page.
  LicenseRegistry.addLicense(() async* {
    yield LicenseEntryWithLineBreaks(const ['IBM Plex'], await rootBundle.loadString('assets/fonts/OFL.txt'));
  });
  // Background uploads: reattach to anything still running from before the app was closed.
  uploads.init().catchError((Object e) => debugPrint('uploads: init failed: $e'));
  // Event links (from Trippin, the website, notifications): opened once signed in.
  DeepLinks.instance.start();
  // Push notifications: Firebase set up early so a tap that launched the app is seen.
  Push.instance.start();
  runApp(ChangeNotifierProvider(create: (_) => Session()..start(), child: const InFrameApp()));
}

class InFrameApp extends StatelessWidget {
  const InFrameApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      navigatorKey: appNavigatorKey,
      scaffoldMessengerKey: pushMessengerKey,
      title: 'InFrame',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(Brightness.light),
      darkTheme: buildTheme(Brightness.dark),
      themeMode: ThemeMode.system,
      home: const _Gate(),
    );
  }
}

/// Splash → sign-in → app, driven by the session.
class _Gate extends StatelessWidget {
  const _Gate();

  @override
  Widget build(BuildContext context) {
    final status = context.watch<Session>().status;
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 250),
      child: switch (status) {
        SessionStatus.loading => const Scaffold(
          key: ValueKey('splash'),
          body: Center(child: Logo(size: 24)),
        ),
        SessionStatus.signedOut => const LoginScreen(key: ValueKey('login')),
        SessionStatus.signedIn => const HomeScreen(key: ValueKey('home')),
      },
    );
  }
}
