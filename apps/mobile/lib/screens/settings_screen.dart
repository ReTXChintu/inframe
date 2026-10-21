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
        content: DsTextField(controller: controller, autofocus: true, textCapitalization: TextCapitalization.words),
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
    final p = DsColors.of(context);
    final session = context.watch<Session>();
    final me = session.me;
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: EdgeInsets.fromLTRB(Ds.pagePad(context), 0, Ds.pagePad(context), 32),
        children: [
          if (me != null)
            Card(
              child: ListTile(
                contentPadding: const EdgeInsets.fromLTRB(16, 4, 8, 4),
                leading: PersonAvatar(name: me.user.name, url: me.self?.selfieUrl, cacheKey: me.self?.selfieCacheKey),
                title: Text(me.user.name, style: Theme.of(context).textTheme.titleSmall),
                subtitle: Text(me.user.email),
                trailing: IconButton(tooltip: 'Edit name', icon: const Icon(Icons.edit_outlined, size: 20), onPressed: () => _editName(me)),
              ),
            ),
          if (me?.user.isAdmin ?? false) ...[
            const SizedBox(height: 12),
            const DsCallout(
              icon: Icons.admin_panel_settings_outlined,
              title: "You're the super admin",
              body: 'Server settings (face model, Google Drive, email) are on the website.',
            ),
          ],
          const SizedBox(height: 16),
          SectionCard(
            title: 'Storage accounts',
            subtitle: 'Where your events keep their original photos.',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_connections == null)
                  const Center(child: CircularProgressIndicator())
                else
                  for (final c in _connections!)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: DsIconTile(providerIcon(c.provider), tone: c.broken ? DsTone.warn : DsTone.neutral),
                      title: Text(c.providerLabel),
                      subtitle: Text(
                        c.broken ? (c.lastError ?? 'Needs reconnecting') : '${c.accountLabel} · ${plural(c.eventCount, 'event')}',
                        style: TextStyle(color: c.broken ? p.warn : null, fontWeight: c.broken ? FontWeight.w500 : null),
                      ),
                      trailing: TextButton(
                        style: TextButton.styleFrom(foregroundColor: p.crit, padding: const EdgeInsets.symmetric(horizontal: 8)),
                        onPressed: () => _disconnect(c),
                        child: const Text('Disconnect'),
                      ),
                    ),
                const SizedBox(height: 8),
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
                const SizedBox(height: 8),
                Text(
                  'Google Drive is connected from the website.',
                  style: TextStyle(color: p.tx3, fontSize: 12, height: 16 / 12),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Card(
            clipBehavior: Clip.antiAlias,
            child: Column(
              children: [
                const ListTile(
                  leading: Icon(Icons.account_circle_outlined),
                  title: Text('Your account'),
                  subtitle: Text('The same sign-in for InFrame, SpendLog and Trippin. Its password is managed there.'),
                ),
                const Divider(),
                ListTile(
                  leading: const Icon(Icons.system_update_outlined),
                  title: const Text('Check for updates'),
                  subtitle: Text('Version $_version', style: const TextStyle(fontFeatures: Ds.tabular)),
                  trailing: const Icon(Icons.chevron_right, size: 18),
                  onTap: () => checkForAppUpdate(context, tellIfCurrent: true),
                ),
                const Divider(),
                ListTile(
                  leading: const Icon(Icons.dns_outlined),
                  title: const Text('Server'),
                  subtitle: Text(api.baseUrl, style: const TextStyle(fontFamily: Ds.mono, fontSize: 12)),
                ),
                const Divider(),
                ListTile(leading: const Icon(Icons.logout), title: const Text('Sign out'), onTap: () => context.read<Session>().signOut()),
                const Divider(),
                ListTile(
                  leading: Icon(Icons.delete_forever_outlined, color: p.crit),
                  title: Text(
                    'Delete account',
                    style: TextStyle(color: p.crit, fontWeight: FontWeight.w600),
                  ),
                  onTap: () =>
                      showModalBottomSheet<void>(context: context, isScrollControlled: true, showDragHandle: true, builder: (_) => const _DeleteSheet()),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _DeleteSheet extends StatefulWidget {
  const _DeleteSheet();

  @override
  State<_DeleteSheet> createState() => _DeleteSheetState();
}

class _DeleteSheetState extends State<_DeleteSheet> {
  final _confirm = TextEditingController();
  bool _busy = false;
  String? _error;

  bool get _confirmed => _confirm.text.trim() == 'DELETE';

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await api.delete<dynamic>('/api/me', {'confirm': _confirm.text.trim()});
      if (!mounted) return;
      Navigator.pop(context);
      await context.read<Session>().signOut();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.fields['confirm'] ?? e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = DsColors.of(context);
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 20 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const DsIconTile(Icons.delete_forever_outlined, tone: DsTone.crit),
              const SizedBox(width: 12),
              Expanded(child: Text('Delete your account?', style: Theme.of(context).textTheme.titleLarge)),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            'Your selfies, family members and storage connections are deleted, and events you own are removed for everyone. '
            'Photo files in your Drive/MEGA stay where they are. Your sign-in account itself stays, for SpendLog and Trippin.',
            style: Theme.of(context).textTheme.bodyLarge!.copyWith(color: p.tx2),
          ),
          const SizedBox(height: 16),
          DsTextField(
            controller: _confirm,
            autocorrect: false,
            enableSuggestions: false,
            textCapitalization: TextCapitalization.characters,
            label: 'Type DELETE to confirm',
            error: _error,
            onChanged: (_) => setState(() {}),
            onSubmitted: (_) => _confirmed ? _submit() : null,
          ),
          const SizedBox(height: 20),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: p.critFill, foregroundColor: Colors.white),
            onPressed: _busy || !_confirmed ? null : _submit,
            child: _busy ? SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2.5, color: p.crit)) : const Text('Delete forever'),
          ),
        ],
      ),
    );
  }
}
