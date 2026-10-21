import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../api/api.dart';
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
  String _kind = 'trip';
  DateTime? _starts;
  DateTime? _ends;
  StorageChoice _storage = const StorageChoice();
  bool _busy = false;
  String? _error;
  Map<String, String> _fields = {};

  static const _kinds = [
    ('trip', 'Trip', Icons.landscape_outlined),
    ('wedding', 'Wedding', Icons.favorite_border),
    ('party', 'Party', Icons.celebration_outlined),
    ('other', 'Other', Icons.auto_awesome_outlined),
  ];

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
        'storage': _storage.toJson(),
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
    final canCreate = _name.text.trim().isNotEmpty && _storage.ready;
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
            child: StoragePicker(newFolderName: _name.text, onChanged: (c) => setState(() => _storage = c)),
          ),
          const SizedBox(height: 20),
          BusyButton(label: 'Create event', busy: _busy, onPressed: canCreate ? _create : null),
        ],
      ),
    );
  }
}
