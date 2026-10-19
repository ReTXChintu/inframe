import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../api/api.dart';
import '../api/models.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/storage.dart';

/// Create an event: details + where its photos are stored. Pops with the new event id.
class NewEventScreen extends StatefulWidget {
  const NewEventScreen({super.key});

  @override
  State<NewEventScreen> createState() => _NewEventScreenState();
}

class _NewEventScreenState extends State<NewEventScreen> {
  final _name = TextEditingController();
  final _folder = TextEditingController();
  String _kind = 'trip';
  DateTime? _starts;
  DateTime? _ends;
  List<Connection>? _connections;
  String? _connectionId;
  bool _existingFolder = false;
  bool _busy = false;
  String? _error;
  Map<String, String> _fields = {};

  static const _kinds = [
    ('trip', 'Trip', Icons.landscape_outlined),
    ('wedding', 'Wedding', Icons.favorite_border),
    ('party', 'Party', Icons.celebration_outlined),
    ('other', 'Other', Icons.auto_awesome_outlined),
  ];

  @override
  void initState() {
    super.initState();
    _loadConnections();
  }

  Future<void> _loadConnections() async {
    try {
      final list = await loadConnections();
      setState(() {
        _connections = list;
        _connectionId ??= list.where((c) => !c.broken && c.provider != 'gdrive').firstOrNull?.id ?? list.firstOrNull?.id;
      });
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    }
  }

  Future<void> _pickDate(bool start) async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: (start ? _starts : _ends) ?? _starts ?? now,
      firstDate: DateTime(now.year - 20),
      lastDate: DateTime(now.year + 5),
    );
    if (picked == null) return;
    setState(() {
      if (start) {
        _starts = picked;
        if (_ends != null && _ends!.isBefore(picked)) _ends = picked;
      } else {
        _ends = picked;
      }
    });
  }

  String? _iso(DateTime? d) => d == null ? null : DateFormat('yyyy-MM-dd').format(d);

  Future<void> _create() async {
    setState(() {
      _busy = true;
      _error = null;
      _fields = {};
    });
    try {
      final res = await api.post<Map<String, dynamic>>('/api/events', {
        'name': _name.text.trim(),
        'kind': _kind,
        'startsOn': _iso(_starts),
        'endsOn': _iso(_ends),
        'storage': {'connectionId': _connectionId, 'folder': _existingFolder ? _folder.text.trim() : null},
      });
      if (mounted) Navigator.pop(context, (res['event'] as Map)['id'] as String);
    } on ApiException catch (e) {
      setState(() => e.fields.isNotEmpty && !e.fields.containsKey('_') ? _fields = e.fields : _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = Palette.of(context);
    final connections = _connections;
    final selected = connections?.where((c) => c.id == _connectionId).firstOrNull;
    final canCreate = _name.text.trim().isNotEmpty && _connectionId != null && (!_existingFolder || _folder.text.trim().isNotEmpty);
    final dateFmt = DateFormat('d MMM yyyy');

    return Scaffold(
      appBar: AppBar(title: const Text('New event')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
        children: [
          ErrorBox(_error),
          if (_error != null) const SizedBox(height: 12),
          SectionCard(
            title: 'The event',
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              TextField(
                controller: _name,
                textCapitalization: TextCapitalization.sentences,
                maxLength: 100,
                decoration: InputDecoration(labelText: 'Name', hintText: 'Goa with the gang', errorText: _fields['name']),
                onChanged: (_) => setState(() {}),
              ),
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final (value, label, icon) in _kinds)
                  ChoiceChip(
                    selected: _kind == value,
                    avatar: Icon(icon, size: 18, color: _kind == value ? p.bg : p.ink2),
                    label: Text(label, style: TextStyle(color: _kind == value ? p.bg : p.ink2)),
                    onSelected: (_) => setState(() => _kind = value),
                  ),
              ]),
              const SizedBox(height: 14),
              Row(children: [
                Expanded(
                  child: OutlinedButton.icon(
                    icon: const Icon(Icons.event_outlined, size: 18),
                    label: Text(_starts == null ? 'Start date' : dateFmt.format(_starts!)),
                    onPressed: () => _pickDate(true),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    icon: const Icon(Icons.event_available_outlined, size: 18),
                    label: Text(_ends == null ? 'End date' : dateFmt.format(_ends!)),
                    onPressed: () => _pickDate(false),
                  ),
                ),
              ]),
            ]),
          ),
          const SizedBox(height: 14),
          SectionCard(
            title: 'Where photos are stored',
            subtitle: 'Photos go into your Google Drive or MEGA folder, with thumbnails in a hidden “.inframe” sub-folder.',
            child: connections == null
                ? const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator()))
                : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    RadioGroup<String>(
                      groupValue: _connectionId,
                      onChanged: (v) => setState(() => _connectionId = v),
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
                            _loadConnections();
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
                        onSelectionChanged: (s) => setState(() => _existingFolder = s.first),
                      ),
                      const SizedBox(height: 12),
                      if (_existingFolder)
                        TextField(
                          controller: _folder,
                          keyboardType: TextInputType.url,
                          onChanged: (_) => setState(() {}),
                          decoration: InputDecoration(
                            labelText: selected.provider == 'gdrive' ? 'Google Drive folder link' : 'MEGA folder link or path',
                            hintText: selected.provider == 'gdrive' ? 'https://drive.google.com/drive/folders/…' : 'https://mega.nz/folder/… or Trips/Goa',
                            helperText: 'Photos already in it are added too. Sub-folders become albums.',
                            helperMaxLines: 2,
                          ),
                        )
                      else
                        Text('InFrame creates “InFrame · ${_name.text.trim().isEmpty ? 'event name' : _name.text.trim()}” in your storage.',
                            style: TextStyle(color: p.muted)),
                    ],
                  ]),
          ),
          const SizedBox(height: 20),
          BusyButton(label: 'Create event', busy: _busy, onPressed: canCreate ? _create : null),
        ],
      ),
    );
  }
}
