import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api.dart';
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

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;
  Map<String, String> _fields = {};

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
      _fields = {};
    });
    try {
      await context.read<Session>().signIn(_email.text.trim(), _password.text);
    } on ApiException catch (e) {
      setState(() => e.fields.isNotEmpty ? _fields = e.fields : _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = Palette.of(context);
    return _AuthScaffold(
      title: 'Welcome back',
      subtitle: "Sign in to see your events and the photos you're in.",
      children: [
        ErrorBox(_error),
        if (_error != null) const SizedBox(height: 14),
        AutofillGroup(
          child: Column(children: [
            TextField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              autofillHints: const [AutofillHints.email],
              textInputAction: TextInputAction.next,
              decoration: InputDecoration(labelText: 'Email', errorText: _fields['email']),
            ),
            const SizedBox(height: 14),
            PasswordField(
              controller: _password,
              label: 'Password',
              error: _fields['password'],
              autofillHints: const [AutofillHints.password],
              textInputAction: TextInputAction.done,
              onSubmitted: (_) => _submit(),
            ),
          ]),
        ),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton(
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ForgotPasswordScreen())),
            child: const Text('Forgot password?'),
          ),
        ),
        const SizedBox(height: 8),
        BusyButton(label: 'Sign in', busy: _busy, onPressed: _submit),
        const SizedBox(height: 20),
        Row(children: [
          Text('New to InFrame?', style: TextStyle(color: p.muted)),
          TextButton(
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const SignupScreen())),
            child: const Text('Create an account', style: TextStyle(fontWeight: FontWeight.w700)),
          ),
        ]),
        const SizedBox(height: 24),
        const ServerLink(),
      ],
    );
  }
}

class SignupScreen extends StatefulWidget {
  const SignupScreen({super.key});

  @override
  State<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends State<SignupScreen> {
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;
  String? _error;
  Map<String, String> _fields = {};

  Future<void> _submit() async {
    if (_password.text != _confirm.text) {
      setState(() => _fields = {'confirm': "The passwords don't match."});
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _fields = {};
    });
    try {
      await context.read<Session>().signUp(_name.text.trim(), _email.text.trim(), _password.text);
      if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
    } on ApiException catch (e) {
      setState(() => e.fields.isNotEmpty ? _fields = e.fields : _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 32),
          children: [
            Text('Create your account', style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 6),
            Text('Start a shared album, or join one with a code.', style: TextStyle(color: Palette.of(context).muted, fontSize: 15)),
            const SizedBox(height: 24),
            ErrorBox(_error),
            if (_error != null) const SizedBox(height: 14),
            TextField(
              controller: _name,
              textCapitalization: TextCapitalization.words,
              autofillHints: const [AutofillHints.name],
              textInputAction: TextInputAction.next,
              decoration: InputDecoration(labelText: 'Your name', errorText: _fields['name']),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              autofillHints: const [AutofillHints.email],
              textInputAction: TextInputAction.next,
              decoration: InputDecoration(labelText: 'Email', errorText: _fields['email']),
            ),
            const SizedBox(height: 14),
            PasswordField(
              controller: _password,
              label: 'Password',
              error: _fields['password'],
              hint: 'At least 8 characters, with a letter and a number.',
              autofillHints: const [AutofillHints.newPassword],
              textInputAction: TextInputAction.next,
            ),
            const SizedBox(height: 14),
            PasswordField(
              controller: _confirm,
              label: 'Confirm password',
              error: _fields['confirm'],
              autofillHints: const [AutofillHints.newPassword],
              onSubmitted: (_) => _submit(),
            ),
            const SizedBox(height: 22),
            BusyButton(label: 'Create account', busy: _busy, onPressed: _submit),
          ],
        ),
      ),
    );
  }
}

class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final _email = TextEditingController();
  bool _busy = false;
  bool _sent = false;
  String? _error;

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await api.post<dynamic>('/api/auth/forgot-password', {'email': _email.text.trim()});
      setState(() => _sent = true);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = Palette.of(context);
    return Scaffold(
      appBar: AppBar(),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 32),
        children: _sent
            ? [
                Icon(Icons.mark_email_read_outlined, size: 40, color: p.accent),
                const SizedBox(height: 16),
                Text('Check your email', style: Theme.of(context).textTheme.headlineMedium),
                const SizedBox(height: 8),
                Text(
                  "If an account exists for ${_email.text.trim()}, we've sent a link to choose a new password. "
                  'Open it on any device — then sign in here with the new password.',
                  style: TextStyle(color: p.muted, fontSize: 15),
                ),
              ]
            : [
                Text('Forgot your password?', style: Theme.of(context).textTheme.headlineMedium),
                const SizedBox(height: 6),
                Text("Enter your email and we'll send you a reset link.", style: TextStyle(color: p.muted, fontSize: 15)),
                const SizedBox(height: 24),
                ErrorBox(_error),
                if (_error != null) const SizedBox(height: 14),
                TextField(
                  controller: _email,
                  keyboardType: TextInputType.emailAddress,
                  decoration: const InputDecoration(labelText: 'Email'),
                  onSubmitted: (_) => _submit(),
                ),
                const SizedBox(height: 20),
                BusyButton(label: 'Send reset link', busy: _busy, onPressed: _submit),
              ],
      ),
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
