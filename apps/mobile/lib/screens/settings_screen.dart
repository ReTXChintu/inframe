import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:provider/provider.dart';

import '../api/api.dart';
import '../api/models.dart';
import '../state/session.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/storage.dart';
import '../widgets/update_banner.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  List<Connection>? _connections;
  String _version = '';

  @override
  void initState() {
    super.initState();
    _loadConnections();
    PackageInfo.fromPlatform().then((i) => mounted ? setState(() => _version = '${i.version} (${i.buildNumber})') : null);
  }

  Future<void> _loadConnections() async {
    try {
      final list = await loadConnections();
      if (mounted) setState(() => _connections = list);
    } on ApiException {
      // shown as empty
    }
  }

  Future<void> _editName(Me me) async {
    final controller = TextEditingController(text: me.user.name);
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Your name'),
        content: TextField(controller: controller, autofocus: true, textCapitalization: TextCapitalization.words),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, controller.text.trim()), child: const Text('Save')),
        ],
      ),
    );
    if (name == null || name.isEmpty || !mounted) return;
    try {
      await api.patch<dynamic>('/api/me', {'name': name});
      if (mounted) context.read<Session>().reloadMe();
    } on ApiException catch (e) {
      if (mounted) toast(context, e.message, error: true);
    }
  }

  Future<void> _disconnect(Connection c) async {
    final ok = await confirm(
      context,
      title: 'Disconnect ${c.providerLabel}?',
      body: c.eventCount > 0
          ? '${plural(c.eventCount, 'event uses', 'events use')} this account. Their photos stay visible, but syncing and uploads stop until a new folder is connected.'
          : 'InFrame forgets this account\'s access.',
      action: 'Disconnect',
      danger: true,
    );
    if (!ok) return;
    try {
      await api.delete<dynamic>('/api/storage/connections/${c.id}');
      _loadConnections();
    } on ApiException catch (e) {
      if (mounted) toast(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = Palette.of(context);
    final session = context.watch<Session>();
    final me = session.me;
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
        children: [
          if (me != null)
            Card(
              child: ListTile(
                leading: PersonAvatar(name: me.user.name, url: me.self?.selfieUrl, cacheKey: me.self?.selfieCacheKey),
                title: Text(me.user.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                subtitle: Text(me.user.email),
                trailing: IconButton(tooltip: 'Edit name', icon: const Icon(Icons.edit_outlined), onPressed: () => _editName(me)),
              ),
            ),
          if (me?.user.isAdmin ?? false) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(color: p.accentSoft, borderRadius: BorderRadius.circular(16)),
              child: Row(children: [
                Icon(Icons.admin_panel_settings_outlined, color: p.accent),
                const SizedBox(width: 10),
                const Expanded(child: Text("You're the super admin. Server settings (face model, Google Drive, email) are on the website.")),
              ]),
            ),
          ],
          const SizedBox(height: 14),
          SectionCard(
            title: 'Storage accounts',
            subtitle: 'Where your events keep their original photos.',
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              if (_connections == null)
                const Center(child: CircularProgressIndicator())
              else
                for (final c in _connections!)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(providerIcon(c.provider)),
                    title: Text(c.providerLabel),
                    subtitle: Text(c.broken ? (c.lastError ?? 'Needs reconnecting') : '${c.accountLabel} · ${plural(c.eventCount, 'event')}',
                        style: TextStyle(color: c.broken ? p.warn : null)),
                    trailing: TextButton(onPressed: () => _disconnect(c), child: Text('Disconnect', style: TextStyle(color: p.danger))),
                  ),
              const SizedBox(height: 6),
              Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton.icon(
                  icon: const Icon(Icons.cloud_outlined),
                  label: const Text('Connect MEGA'),
                  onPressed: () async {
                    if (await connectMega(context) != null) _loadConnections();
                  },
                ),
              ),
              const SizedBox(height: 6),
              Text('Google Drive is connected from the website.', style: TextStyle(color: p.muted, fontSize: 12)),
            ]),
          ),
          const SizedBox(height: 14),
          Card(
            child: Column(children: [
              ListTile(
                leading: const Icon(Icons.lock_outline),
                title: const Text('Change password'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => showModalBottomSheet<void>(context: context, isScrollControlled: true, showDragHandle: true, builder: (_) => const _PasswordSheet()),
              ),
              const Divider(),
              ListTile(
                leading: const Icon(Icons.system_update_outlined),
                title: const Text('Check for updates'),
                subtitle: Text('Version $_version'),
                onTap: () => checkForAppUpdate(context, tellIfCurrent: true),
              ),
              const Divider(),
              ListTile(
                leading: const Icon(Icons.dns_outlined),
                title: const Text('Server'),
                subtitle: Text(api.baseUrl),
              ),
              const Divider(),
              ListTile(
                leading: const Icon(Icons.logout),
                title: const Text('Sign out'),
                onTap: () => context.read<Session>().signOut(),
              ),
              const Divider(),
              ListTile(
                leading: Icon(Icons.delete_forever_outlined, color: p.danger),
                title: Text('Delete account', style: TextStyle(color: p.danger)),
                onTap: () => showModalBottomSheet<void>(context: context, isScrollControlled: true, showDragHandle: true, builder: (_) => const _DeleteSheet()),
              ),
            ]),
          ),
        ],
      ),
    );
  }
}

class _PasswordSheet extends StatefulWidget {
  const _PasswordSheet();

  @override
  State<_PasswordSheet> createState() => _PasswordSheetState();
}

class _PasswordSheetState extends State<_PasswordSheet> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;
  Map<String, String> _fields = {};

  Future<void> _submit() async {
    if (_next.text != _confirm.text) {
      setState(() => _fields = {'confirm': "The passwords don't match."});
      return;
    }
    setState(() {
      _busy = true;
      _fields = {};
    });
    try {
      final res = await api.post<Map<String, dynamic>>('/api/me/password', {'currentPassword': _current.text, 'newPassword': _next.text});
      if (!mounted) return;
      await context.read<Session>().adoptTokens(res);
      if (mounted) {
        Navigator.pop(context);
        toast(context, 'Password changed. Other devices were signed out.');
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _fields = e.fields.isNotEmpty ? e.fields : {'newPassword': e.message});
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('Change password', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 16),
        PasswordField(controller: _current, label: 'Current password', error: _fields['currentPassword'], autofillHints: const [AutofillHints.password]),
        const SizedBox(height: 12),
        PasswordField(controller: _next, label: 'New password', error: _fields['newPassword'], hint: '8+ characters, a letter and a number.', autofillHints: const [AutofillHints.newPassword]),
        const SizedBox(height: 12),
        PasswordField(controller: _confirm, label: 'Confirm new password', error: _fields['confirm'], onSubmitted: (_) => _submit()),
        const SizedBox(height: 18),
        BusyButton(label: 'Change password', busy: _busy, onPressed: _submit),
      ]),
    );
  }
}

class _DeleteSheet extends StatefulWidget {
  const _DeleteSheet();

  @override
  State<_DeleteSheet> createState() => _DeleteSheetState();
}

class _DeleteSheetState extends State<_DeleteSheet> {
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await api.delete<dynamic>('/api/me', {'password': _password.text});
      if (!mounted) return;
      Navigator.pop(context);
      await context.read<Session>().signOut();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.fields['password'] ?? e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = Palette.of(context);
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('Delete your account?', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 8),
        Text(
          'Your selfies, family members and storage connections are deleted, and events you own are removed for everyone. '
          'Photo files in your Drive/MEGA stay where they are.',
          style: TextStyle(color: p.muted),
        ),
        const SizedBox(height: 16),
        PasswordField(controller: _password, label: 'Your password', error: _error, onSubmitted: (_) => _submit()),
        const SizedBox(height: 18),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: p.danger, foregroundColor: Colors.white),
          onPressed: _busy || _password.text.isEmpty ? null : _submit,
          child: _busy ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Delete forever'),
        ),
      ]),
    );
  }
}
