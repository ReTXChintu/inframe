import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'screens/auth_screens.dart';
import 'screens/home.dart';
import 'state/session.dart';
import 'theme.dart';
import 'widgets/common.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(ChangeNotifierProvider(create: (_) => Session()..start(), child: const InFrameApp()));
}

class InFrameApp extends StatelessWidget {
  const InFrameApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'InFrame',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(Brightness.light),
      darkTheme: buildTheme(Brightness.dark),
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
        SessionStatus.loading => const Scaffold(key: ValueKey('splash'), body: Center(child: Logo(size: 28))),
        SessionStatus.signedOut => const LoginScreen(key: ValueKey('login')),
        SessionStatus.signedIn => const HomeScreen(key: ValueKey('home')),
      },
    );
  }
}
