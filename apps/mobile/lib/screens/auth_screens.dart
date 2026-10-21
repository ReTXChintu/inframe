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
    // §6.2 on a phone: a short brand block (logo, headline, benefits), then
    // the auth card. Full width with 16 px side padding.
    final p = DsColors.of(context);
    final text = Theme.of(context).textTheme;
    final pad = Ds.pagePad(context);
    Widget benefit(IconData icon, String line) => Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Row(
        children: [
          DsIconTile(icon, size: 36),
          const SizedBox(width: 12),
          Expanded(
            child: Text(line, style: text.bodyMedium!.copyWith(color: p.tx2)),
          ),
        ],
      ),
    );
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: EdgeInsets.fromLTRB(pad, 24, pad, 32),
          children: [
            const Align(alignment: Alignment.centerLeft, child: Logo()),
            const SizedBox(height: 32),
            Text('Every photo from the event. The ones you’re in, found for you.', style: text.headlineSmall),
            const SizedBox(height: 4),
            benefit(Icons.photo_library_outlined, 'One shared album for the whole group'),
            benefit(Icons.face_retouching_natural, 'Your photos found by a selfie, never shown to others'),
            benefit(Icons.cloud_outlined, 'Originals stay in your own Drive or MEGA'),
            const SizedBox(height: 28),
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: p.sf,
                border: Border.all(color: p.ln),
                borderRadius: BorderRadius.circular(Ds.rXl),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(title, style: text.headlineSmall),
                  const SizedBox(height: 6),
                  Text(subtitle, style: text.bodyLarge!.copyWith(color: p.tx2)),
                  const SizedBox(height: 20),
                  ...children,
                ],
              ),
            ),
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
    final p = DsColors.of(context);
    return _AuthScaffold(
      title: 'Welcome to InFrame',
      subtitle: "Sign in to see your events and the photos you're in.",
      children: [
        ErrorBox(_error),
        if (_error != null) const SizedBox(height: 16),
        SizedBox(
          height: 52,
          child: BusyButton(label: 'Sign in', icon: Icons.login, busy: _busy, onPressed: _signIn),
        ),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(color: p.sunk, borderRadius: BorderRadius.circular(Ds.rLg)),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.info_outline, size: 18, color: p.tx2),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'One account for InFrame, SpendLog and Trippin. New here? Signing in creates your InFrame account.',
                  style: Theme.of(context).textTheme.bodySmall!.copyWith(color: p.tx2),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
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
        content: DsTextField(
          controller: controller,
          keyboardType: TextInputType.url,
          autocorrect: false,
          label: 'Server address',
          hint: 'http://203.0.113.5:50010',
          style: Theme.of(ctx).textTheme.bodyLarge!.copyWith(fontFamily: Ds.mono),
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
    final p = DsColors.of(context);
    return Row(
      children: [
        Icon(Icons.dns_outlined, size: 16, color: p.tx3),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            api.baseUrl,
            style: TextStyle(fontFamily: Ds.mono, color: p.tx3, fontSize: 12, height: 16 / 12),
            overflow: TextOverflow.ellipsis,
          ),
        ),
        TextButton(onPressed: _edit, child: const Text('Change')),
      ],
    );
  }
}
