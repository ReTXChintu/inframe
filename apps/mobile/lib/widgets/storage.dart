import 'package:flutter/material.dart';

import '../api/api.dart';
import '../api/models.dart';
import '../theme.dart';
import 'common.dart';

Future<List<Connection>> loadConnections() async {
  final res = await api.get<Map<String, dynamic>>('/api/storage/connections');
  return (res['connections'] as List).map((c) => Connection(Map<String, dynamic>.from(c as Map))).toList();
}

IconData providerIcon(String provider) => switch (provider) {
  'gdrive' => Icons.add_to_drive,
  'mega' => Icons.cloud_outlined,
  _ => Icons.memory,
};

/// Where an event's photos go: one of the user's storage accounts, and a new
/// folder or an existing one. The body of `{connectionId, folder}` that
/// `POST /api/events` (as `storage`) and `PUT /api/events/:id/storage` take.
class StorageChoice {
  const StorageChoice({this.connectionId, this.existingFolder = false, this.folder = ''});
  final String? connectionId;
  final bool existingFolder;
  final String folder;

  bool get ready => connectionId != null && (!existingFolder || folder.trim().isNotEmpty);
  Map<String, dynamic> toJson() => {'connectionId': connectionId, 'folder': existingFolder ? folder.trim() : null};
}

/// Pick a storage account (or connect MEGA) and a new or existing folder.
/// Used when creating an event and when connecting a folder to one later.
class StoragePicker extends StatefulWidget {
  const StoragePicker({super.key, required this.newFolderName, required this.onChanged});

  /// Shown as the folder InFrame creates: “InFrame · `newFolderName`”.
  final String newFolderName;
  final ValueChanged<StorageChoice> onChanged;

  @override
  State<StoragePicker> createState() => _StoragePickerState();
}

class _StoragePickerState extends State<StoragePicker> {
  final _folder = TextEditingController();
  List<Connection>? _connections;
  String? _connectionId;
  bool _existingFolder = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _folder.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final list = await loadConnections();
      if (!mounted) return;
      setState(() {
        _connections = list;
        _error = null;
        _connectionId ??= list.where((c) => !c.broken && c.provider != 'gdrive').firstOrNull?.id ?? list.firstOrNull?.id;
      });
      _report();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  void _report() => widget.onChanged(StorageChoice(connectionId: _connectionId, existingFolder: _existingFolder, folder: _folder.text));

  void _update(VoidCallback change) {
    setState(change);
    _report();
  }

  @override
  Widget build(BuildContext context) {
    final p = DsColors.of(context);
    final connections = _connections;
    if (connections == null) {
      return _error != null
          ? ErrorBox(_error)
          : const Center(
              child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator()),
            );
    }
    final selected = connections.where((c) => c.id == _connectionId).firstOrNull;
    final name = widget.newFolderName.trim();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        RadioGroup<String>(
          groupValue: _connectionId,
          onChanged: (v) => _update(() => _connectionId = v),
          child: Column(
            children: [
              for (final c in connections)
                RadioListTile<String>(
                  value: c.id,
                  enabled: !c.broken,
                  contentPadding: EdgeInsets.zero,
                  secondary: DsIconTile(providerIcon(c.provider), tone: c.broken ? DsTone.warn : DsTone.neutral),
                  title: Text(c.providerLabel),
                  subtitle: Text(
                    c.broken ? 'Needs reconnecting' : c.accountLabel,
                    overflow: TextOverflow.ellipsis,
                    style: c.broken ? TextStyle(color: p.warn, fontWeight: FontWeight.w500) : null,
                  ),
                ),
            ],
          ),
        ),
        if (connections.isEmpty)
          Text(
            'Connect a storage account to keep this event\'s photos in your own storage.',
            style: Theme.of(context).textTheme.bodyMedium!.copyWith(color: p.tx2),
          ),
        const SizedBox(height: 8),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton.icon(
            icon: const Icon(Icons.cloud_outlined),
            label: const Text('Connect MEGA'),
            onPressed: () async {
              final c = await connectMega(context);
              if (c != null) {
                _connectionId = c.id;
                _load();
              }
            },
          ),
        ),
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Text(
            'Google Drive is connected from the website (Settings → Storage).',
            style: TextStyle(color: p.tx3, fontSize: 12, height: 16 / 12),
          ),
        ),
        if (selected != null) ...[
          const Divider(height: 32),
          DsSegmented<bool>(
            label: 'Folder',
            value: _existingFolder,
            options: const [(false, 'New folder', Icons.create_new_folder_outlined), (true, 'Existing', Icons.folder_open_outlined)],
            onChanged: (v) => _update(() => _existingFolder = v),
          ),
          const SizedBox(height: 12),
          if (_existingFolder)
            DsTextField(
              controller: _folder,
              keyboardType: TextInputType.url,
              autocorrect: false,
              onChanged: (_) => _update(() {}),
              label: selected.provider == 'gdrive' ? 'Google Drive folder link' : 'MEGA folder link or path',
              hint: selected.provider == 'gdrive' ? 'https://drive.google.com/drive/folders/…' : 'https://mega.nz/folder/… or Trips/Goa',
              helper: 'Photos already in it are added too. Sub-folders become albums.',
            )
          else
            Text(
              'InFrame creates “InFrame · ${name.isEmpty ? 'event name' : name}” in your storage.',
              style: Theme.of(context).textTheme.bodyMedium!.copyWith(color: p.tx2),
            ),
        ],
      ],
    );
  }
}

/// Bottom sheet: sign in to MEGA. Returns the new connection.
Future<Connection?> connectMega(BuildContext context) {
  return showModalBottomSheet<Connection>(context: context, isScrollControlled: true, showDragHandle: true, builder: (_) => const _MegaSheet());
}

class _MegaSheet extends StatefulWidget {
  const _MegaSheet();

  @override
  State<_MegaSheet> createState() => _MegaSheetState();
}

class _MegaSheetState extends State<_MegaSheet> {
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
      final res = await api.post<Map<String, dynamic>>('/api/storage/mega', {'email': _email.text.trim(), 'password': _password.text});
      if (mounted) Navigator.pop(context, Connection(Map<String, dynamic>.from(res['connection'] as Map)));
    } on ApiException catch (e) {
      setState(() => e.fields.isNotEmpty ? _fields = e.fields : _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = DsColors.of(context);
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.viewInsetsOf(context).bottom + MediaQuery.paddingOf(context).bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const DsIconTile(Icons.cloud_outlined),
                const SizedBox(width: 12),
                Expanded(child: Text('Connect MEGA', style: Theme.of(context).textTheme.titleLarge)),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              'InFrame signs in to your MEGA account to save and read event photos. Your password is stored encrypted. '
              "Accounts with two-factor login aren't supported.",
              style: Theme.of(context).textTheme.bodyMedium!.copyWith(color: p.tx2),
            ),
            const SizedBox(height: 16),
            ErrorBox(_error),
            if (_error != null) const SizedBox(height: 12),
            DsTextField(controller: _email, keyboardType: TextInputType.emailAddress, autocorrect: false, label: 'MEGA email', error: _fields['email']),
            const SizedBox(height: 16),
            DsPasswordField(controller: _password, label: 'MEGA password', error: _fields['password'], onSubmitted: (_) => _submit()),
            const SizedBox(height: 20),
            BusyButton(label: 'Connect MEGA', busy: _busy, onPressed: _submit),
          ],
        ),
      ),
    );
  }
}
