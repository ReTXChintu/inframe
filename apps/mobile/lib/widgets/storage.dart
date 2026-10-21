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

  void _report() =>
      widget.onChanged(StorageChoice(connectionId: _connectionId, existingFolder: _existingFolder, folder: _folder.text));

  void _update(VoidCallback change) {
    setState(change);
    _report();
  }

  @override
  Widget build(BuildContext context) {
    final p = Palette.of(context);
    final connections = _connections;
    if (connections == null) {
      return _error != null ? ErrorBox(_error) : const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator()));
    }
    final selected = connections.where((c) => c.id == _connectionId).firstOrNull;
    final name = widget.newFolderName.trim();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      RadioGroup<String>(
        groupValue: _connectionId,
        onChanged: (v) => _update(() => _connectionId = v),
        child: Column(children: [
          for (final c in connections)
            RadioListTile<String>(
              value: c.id,
              enabled: !c.broken,
              contentPadding: EdgeInsets.zero,
              secondary: Icon(providerIcon(c.provider)),
              title: Text(c.providerLabel),
              subtitle: Text(c.broken ? 'Needs reconnecting' : c.accountLabel, overflow: TextOverflow.ellipsis),
            ),
        ]),
      ),
      if (connections.isEmpty)
        Text('Connect a storage account to keep this event\'s photos in your own storage.', style: TextStyle(color: p.muted)),
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
        child: Text('Google Drive is connected from the website (Settings → Storage).', style: TextStyle(color: p.muted, fontSize: 12)),
      ),
      if (selected != null) ...[
        const Divider(height: 28),
        SegmentedButton<bool>(
          segments: const [
            ButtonSegment(value: false, icon: Icon(Icons.create_new_folder_outlined), label: Text('New folder')),
            ButtonSegment(value: true, icon: Icon(Icons.folder_open_outlined), label: Text('Existing')),
          ],
          selected: {_existingFolder},
          onSelectionChanged: (s) => _update(() => _existingFolder = s.first),
        ),
        const SizedBox(height: 12),
        if (_existingFolder)
          TextField(
            controller: _folder,
            keyboardType: TextInputType.url,
            onChanged: (_) => _update(() {}),
            decoration: InputDecoration(
              labelText: selected.provider == 'gdrive' ? 'Google Drive folder link' : 'MEGA folder link or path',
              hintText: selected.provider == 'gdrive' ? 'https://drive.google.com/drive/folders/…' : 'https://mega.nz/folder/… or Trips/Goa',
              helperText: 'Photos already in it are added too. Sub-folders become albums.',
              helperMaxLines: 2,
            ),
          )
        else
          Text('InFrame creates “InFrame · ${name.isEmpty ? 'event name' : name}” in your storage.', style: TextStyle(color: p.muted)),
      ],
    ]);
  }
}

/// Bottom sheet: sign in to MEGA. Returns the new connection.
Future<Connection?> connectMega(BuildContext context) {
  return showModalBottomSheet<Connection>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => const _MegaSheet(),
  );
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
    final p = Palette.of(context);
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('Connect MEGA', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 6),
        Text(
          'InFrame signs in to your MEGA account to save and read event photos. Your password is stored encrypted. '
          "Accounts with two-factor login aren't supported.",
          style: TextStyle(color: p.muted, fontSize: 13),
        ),
        const SizedBox(height: 16),
        ErrorBox(_error),
        if (_error != null) const SizedBox(height: 12),
        TextField(
          controller: _email,
          keyboardType: TextInputType.emailAddress,
          decoration: InputDecoration(labelText: 'MEGA email', errorText: _fields['email']),
        ),
        const SizedBox(height: 12),
        PasswordField(controller: _password, label: 'MEGA password', error: _fields['password'], onSubmitted: (_) => _submit()),
        const SizedBox(height: 18),
        BusyButton(label: 'Connect MEGA', busy: _busy, onPressed: _submit),
      ]),
    );
  }
}
