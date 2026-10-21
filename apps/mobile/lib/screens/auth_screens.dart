import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api.dart';
import '../auth/identity.dart';
import '../state/session.dart';
import '../theme.dart';
import '../widgets/common.dart';

class _AuthScaffold extends StatelessWidget {
  const _AuthScaffold({required this.title, required this.subtitle, required this.children});
  final String title;
  final String subtitle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final p = Palette.of(context);
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
          children: [
            const Align(alignment: Alignment.centerLeft, child: Logo()),
            const SizedBox(height: 40),
            Text(title, style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 6),
            Text(subtitle, style: TextStyle(color: p.muted, fontSize: 15)),
            const SizedBox(height: 28),
            ...children,
          ],
        ),
      ),
    );
  }
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

/// One button: sign in at the identity server shared by InFrame, SpendLog and
/// Trippin. A first sign-in creates the InFrame account.
class _LoginScreenState extends State<LoginScreen> {
  bool _busy = false;
  String? _error;

  Future<void> _signIn() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await context.read<Session>().signIn();
    } on IdentityException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = Palette.of(context);
    return _AuthScaffold(
      title: 'Welcome to InFrame',
      subtitle: "Sign in to see your events and the photos you're in.",
      children: [
        ErrorBox(_error),
        if (_error != null) const SizedBox(height: 14),
        BusyButton(label: 'Sign in', icon: Icons.login, busy: _busy, onPressed: _signIn),
        const SizedBox(height: 14),
        Text(
          'One account for InFrame, SpendLog and Trippin. New here? Signing in creates your InFrame account.',
          style: TextStyle(color: p.muted, fontSize: 14),
        ),
        const SizedBox(height: 24),
        const ServerLink(),
      ],
    );
  }
}

/// "Server: host:port · Change" — for self-hosted or test servers.
class ServerLink extends StatefulWidget {
  const ServerLink({super.key});

  @override
  State<ServerLink> createState() => _ServerLinkState();
}

class _ServerLinkState extends State<ServerLink> {
  Future<void> _edit() async {
    final controller = TextEditingController(text: api.baseUrl);
    final value = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('InFrame server'),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.url,
          decoration: const InputDecoration(labelText: 'Server address', hintText: 'http://203.0.113.5:50010'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, controller.text), child: const Text('Save')),
        ],
      ),
    );
    if (value != null) {
      await api.setServer(value);
      setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = Palette.of(context);
    return Row(children: [
      Icon(Icons.dns_outlined, size: 16, color: p.muted),
      const SizedBox(width: 6),
      Expanded(child: Text(api.baseUrl, style: TextStyle(color: p.muted, fontSize: 13), overflow: TextOverflow.ellipsis)),
      TextButton(onPressed: _edit, child: const Text('Change')),
    ]);
  }
}
