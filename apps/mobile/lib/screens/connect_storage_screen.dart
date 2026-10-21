import 'package:flutter/material.dart';

import '../api/api.dart';
import '../api/models.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/storage.dart';

/// Owner only: pick the storage folder for an event that doesn't have one yet
/// (events created from Trippin start this way). Pops with `true` once connected.
class ConnectStorageScreen extends StatefulWidget {
  const ConnectStorageScreen({super.key, required this.event});
  final EventDetail event;

  @override
  State<ConnectStorageScreen> createState() => _ConnectStorageScreenState();
}

class _ConnectStorageScreenState extends State<ConnectStorageScreen> {
  StorageChoice _storage = const StorageChoice();
  bool _busy = false;
  String? _error;

  Future<void> _connect() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await api.put<dynamic>('/api/events/${widget.event.id}/storage', _storage.toJson());
      if (!mounted) return;
      toast(context, 'Folder connected. Photos can be added now.');
      Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Connect a folder')),
      body: ListView(
        padding: EdgeInsets.fromLTRB(Ds.pagePad(context), 8, Ds.pagePad(context), 32),
        children: [
          ErrorBox(_error),
          if (_error != null) const SizedBox(height: 12),
          SectionCard(
            title: 'Where photos are stored',
            subtitle: 'Photos go into your Google Drive or MEGA folder, with thumbnails in a hidden “.inframe” sub-folder.',
            child: StoragePicker(newFolderName: widget.event.name, onChanged: (c) => setState(() => _storage = c)),
          ),
          const SizedBox(height: 20),
          BusyButton(label: 'Connect folder', busy: _busy, onPressed: _storage.ready ? _connect : null),
        ],
      ),
    );
  }
}
