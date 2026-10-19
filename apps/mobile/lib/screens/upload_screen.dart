import 'dart:async';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../api/api.dart';
import '../api/models.dart';
import '../theme.dart';
import '../widgets/common.dart';

enum _Stage { queued, uploading, storing, processing, findingFaces, done, failed }

class _Item {
  _Item(this.file);
  final XFile file;
  _Stage stage = _Stage.queued;
  double progress = 0;
  String? photoId;
  int? faces;
  int matches = 0;
  String? error;
  int? size;
}

/// Pick photos → upload each with byte progress → follow processing until faces are matched.
class UploadScreen extends StatefulWidget {
  const UploadScreen({super.key, required this.event});
  final EventDetail event;

  @override
  State<UploadScreen> createState() => _UploadScreenState();
}

class _UploadScreenState extends State<UploadScreen> {
  final _items = <_Item>[];
  String? _folderId;
  int _active = 0;
  Timer? _poll;

  static const _concurrency = 2;

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _pick() async {
    final files = await ImagePicker().pickMultiImage(requestFullMetadata: true);
    if (files.isEmpty) return;
    final items = <_Item>[];
    for (final f in files) {
      items.add(_Item(f)..size = await File(f.path).length());
    }
    setState(() => _items.addAll(items));
    _pump();
  }

  void _pump() {
    while (_active < _concurrency) {
      final next = _items.where((i) => i.stage == _Stage.queued).firstOrNull;
      if (next == null) break;
      _active++;
      _send(next).whenComplete(() {
        _active--;
        _pump();
      });
    }
    _ensurePolling();
  }

  Future<void> _send(_Item item) async {
    setState(() {
      item.stage = _Stage.uploading;
      item.progress = 0;
      item.error = null;
    });
    try {
      final res = await api.upload<Map<String, dynamic>>(
        '/api/events/${widget.event.id}/photos${_folderId != null ? '?folderId=$_folderId' : ''}',
        () => FormData.fromMap({'file': MultipartFile.fromFileSync(item.file.path, filename: item.file.name)}),
        onProgress: (f) {
          if (!mounted) return;
          setState(() {
            item.progress = f;
            // Every byte sent: the server is now writing the file into Drive/MEGA.
            if (f >= 1) item.stage = _Stage.storing;
          });
        },
      );
      setState(() {
        item.photoId = (res['photo'] as Map)['id'] as String;
        item.stage = _Stage.processing;
      });
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          item.stage = _Stage.failed;
          item.error = e.message;
        });
      }
    }
  }

  void _ensurePolling() {
    _poll ??= Timer.periodic(const Duration(seconds: 3), (_) => _check());
  }

  Future<void> _check() async {
    final tracking = _items.where((i) => i.photoId != null && (i.stage == _Stage.processing || i.stage == _Stage.findingFaces)).toList();
    if (tracking.isEmpty) {
      if (!_items.any((i) => i.stage == _Stage.queued || i.stage == _Stage.uploading || i.stage == _Stage.storing)) {
        _poll?.cancel();
        _poll = null;
      }
      return;
    }
    try {
      final res = await api.post<Map<String, dynamic>>('/api/photos/status', {'photoIds': tracking.map((i) => i.photoId).toList()});
      if (!mounted) return;
      setState(() {
        for (final s in (res['photos'] as List).cast<Map>()) {
          final item = tracking.where((i) => i.photoId == s['id']).firstOrNull;
          if (item == null) continue;
          if (s['status'] == 'failed') {
            item.stage = _Stage.failed;
            item.error = '${s['error'] ?? 'Processing failed.'}';
          } else if (s['faceStatus'] == 'done') {
            item.stage = _Stage.done;
            item.faces = (s['faceCount'] as num?)?.toInt();
            item.matches = (s['matchCount'] as num?)?.toInt() ?? 0;
          } else if (s['faceStatus'] == 'failed') {
            item.stage = _Stage.done;
            item.error = 'Saved · face scan failed';
          } else if (s['status'] == 'ready') {
            item.stage = _Stage.findingFaces;
          }
        }
      });
    } on ApiException {
      // try again next tick
    }
  }

  Future<void> _retry(_Item item) async {
    if (item.photoId != null) {
      try {
        await api.post<dynamic>('/api/photos/${item.photoId}/retry');
        setState(() {
          item.stage = _Stage.processing;
          item.error = null;
        });
        _ensurePolling();
      } on ApiException catch (e) {
        if (mounted) toast(context, e.message, error: true);
      }
    } else {
      setState(() => item.stage = _Stage.queued);
      _pump();
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = Palette.of(context);
    final event = widget.event;
    final done = _items.where((i) => i.stage == _Stage.done).length;
    final failed = _items.where((i) => i.stage == _Stage.failed).length;
    final matched = _items.where((i) => i.matches > 0).length;
    final busy = _items.any((i) => i.stage == _Stage.queued || i.stage == _Stage.uploading || i.stage == _Stage.storing);

    return PopScope(
      canPop: !busy,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        if (await confirm(context, title: 'Stop uploading?', body: 'Photos that haven\'t finished uploading will be skipped.', action: 'Stop')) {
          if (context.mounted) Navigator.pop(context);
        }
      },
      child: Scaffold(
        appBar: AppBar(title: const Text('Add photos')),
        floatingActionButton: FloatingActionButton.extended(
          backgroundColor: p.ink,
          foregroundColor: p.bg,
          icon: const Icon(Icons.add_photo_alternate_outlined),
          label: Text(_items.isEmpty ? 'Choose photos' : 'Add more'),
          onPressed: _pick,
        ),
        body: ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 96),
          children: [
            Text(
              'Originals are saved to ${event.storageFolderName != null ? '“${event.storageFolderName}”' : 'the event\'s storage'}. Faces are matched as each one arrives.',
              style: TextStyle(color: p.muted),
            ),
            if (event.canViewAll && event.folders.isNotEmpty) ...[
              const SizedBox(height: 14),
              DropdownButtonFormField<String?>(
                initialValue: _folderId,
                decoration: const InputDecoration(labelText: 'Add to album'),
                items: [
                  const DropdownMenuItem<String?>(value: null, child: Text('No album')),
                  for (final f in event.folders) DropdownMenuItem<String?>(value: f.id, child: Text(f.name)),
                ],
                onChanged: (v) => setState(() => _folderId = v),
              ),
            ],
            const SizedBox(height: 16),
            if (_items.isEmpty)
              EmptyView(
                icon: Icons.add_photo_alternate_outlined,
                title: 'Choose photos to add',
                body: 'Pick as many as you like from your gallery.',
                action: FilledButton.icon(onPressed: _pick, icon: const Icon(Icons.photo_library_outlined), label: const Text('Open gallery')),
              )
            else ...[
              Wrap(spacing: 16, runSpacing: 6, children: [
                _Stat(value: _items.length, label: 'selected'),
                _Stat(value: done, label: 'scanned'),
                _Stat(value: matched, label: 'with you or family', color: p.accent),
                if (failed > 0) _Stat(value: failed, label: 'failed', color: p.danger),
              ]),
              const SizedBox(height: 12),
              Card(
                child: Column(children: [
                  for (final (i, item) in _items.indexed) ...[
                    if (i > 0) const Divider(),
                    _Row(item: item, onRetry: () => _retry(item)),
                  ],
                ]),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.value, required this.label, this.color});
  final int value;
  final String label;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final p = Palette.of(context);
    return Text.rich(TextSpan(children: [
      TextSpan(text: '$value ', style: Theme.of(context).textTheme.titleLarge?.copyWith(color: color ?? p.ink)),
      TextSpan(text: label, style: TextStyle(color: color ?? p.muted)),
    ]));
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.item, required this.onRetry});
  final _Item item;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final p = Palette.of(context);
    final status = switch (item.stage) {
      _Stage.queued => const Pill('Waiting'),
      _Stage.uploading => Pill('Uploading ${(item.progress * 100).round()}%'),
      _Stage.storing => const Pill('Saving to storage…'),
      _Stage.processing => const Pill('Processing…'),
      _Stage.findingFaces => const Pill('Finding faces…', tone: PillTone.warn, icon: Icons.face),
      _Stage.done when item.error != null => Pill(item.error!, tone: PillTone.warn),
      _Stage.done when item.matches > 0 => const Pill('Matched', tone: PillTone.accent, icon: Icons.check_circle),
      _Stage.done => Pill(item.faces != null && item.faces! > 0 ? plural(item.faces!, 'face') : 'No faces', tone: PillTone.ok),
      _Stage.failed => const Pill('Failed', tone: PillTone.danger, icon: Icons.error_outline),
    };
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: Image.file(File(item.file.path), width: 48, height: 48, fit: BoxFit.cover, cacheWidth: 144),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(item.file.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w500)),
            const SizedBox(height: 2),
            Text(
              item.stage == _Stage.failed ? (item.error ?? 'Failed') : formatBytes(item.size),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 12, color: item.stage == _Stage.failed ? p.danger : p.muted),
            ),
            if (item.stage == _Stage.uploading) ...[
              const SizedBox(height: 6),
              LinearProgressIndicator(value: item.progress, minHeight: 3, borderRadius: BorderRadius.circular(2), color: p.ink, backgroundColor: p.surface2),
            ],
          ]),
        ),
        const SizedBox(width: 8),
        status,
        if (item.stage == _Stage.failed || (item.stage == _Stage.done && item.error != null))
          IconButton(tooltip: 'Retry', icon: const Icon(Icons.refresh), onPressed: onRetry),
      ]),
    );
  }
}
