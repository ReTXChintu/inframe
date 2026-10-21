import 'package:background_downloader/background_downloader.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:photo_manager/photo_manager.dart';
import 'package:photo_manager_image_provider/photo_manager_image_provider.dart';

import '../api/api.dart';
import '../api/models.dart';
import '../theme.dart';
import '../uploads/upload_queue.dart';
import '../widgets/common.dart';
import 'gallery_picker.dart';

/// Pick photos and videos from InFrame's own gallery → background uploads →
/// follow the server until each one is stored (and, for photos, faces matched).
/// Leaving this screen, or the app, doesn't stop anything.
class UploadScreen extends StatefulWidget {
  const UploadScreen({super.key, required this.event});
  final EventDetail event;

  @override
  State<UploadScreen> createState() => _UploadScreenState();
}

class _UploadScreenState extends State<UploadScreen> {
  String? _folderId;
  bool _preparing = false;
  int _prepared = 0;
  int _preparingTotal = 0;

  Future<void> _pick() async {
    final assets = await GalleryPicker.open(context);
    if (assets == null || assets.isEmpty || !mounted) return;
    setState(() {
      _preparing = true;
      _prepared = 0;
      _preparingTotal = assets.length;
    });
    try {
      final files = await _describe(assets);
      if (!mounted) return;
      if (files.length < assets.length) {
        toast(context, "${plural(assets.length - files.length, 'file')} couldn't be read and were skipped.", error: true);
      }
      if (files.isEmpty) return;

      final dupes = await uploads.findDuplicates(widget.event.id, files);
      if (!mounted) return;
      var chosen = files;
      if (dupes.isNotEmpty) {
        final repeated = files.where((f) => dupes.contains(f.key)).toList();
        final skip = await _askAboutDuplicates(repeated, files.length);
        if (skip == null || !mounted) return;
        if (skip) chosen = files.where((f) => !dupes.contains(f.key)).toList();
      }
      if (chosen.isEmpty) {
        toast(context, "Nothing new to upload — they're all here already.");
        return;
      }
      await _askForNotifications();
      await uploads.add(widget.event.id, chosen, folderId: _folderId);
    } on ApiException catch (e) {
      if (mounted) toast(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _preparing = false);
    }
  }

  /// Name, size, date, MIME type and content URI for each picked asset.
  Future<List<PickedMedia>> _describe(List<AssetEntity> assets) async {
    final out = <PickedMedia?>[];
    const batch = 24;
    for (var i = 0; i < assets.length; i += batch) {
      final slice = assets.sublist(i, (i + batch).clamp(0, assets.length));
      out.addAll(
        await Future.wait(
          slice.map((a) async {
            try {
              final uri = await a.getMediaUrl();
              if (uri == null) return null;
              final name = (a.title?.isNotEmpty ?? false) ? a.title! : await a.titleAsync;
              final isVideo = a.type == AssetType.video;
              return PickedMedia(
                assetId: a.id,
                uri: uri,
                name: name.isEmpty ? '${a.id}.${isVideo ? 'mp4' : 'jpg'}' : name,
                size: await a.fileSize,
                isVideo: isVideo,
                mimeType: a.mimeType ?? await a.mimeTypeAsync ?? (isVideo ? 'video/mp4' : 'image/jpeg'),
                modifiedAt: (a.modifiedDateSecond ?? a.createDateSecond ?? 0) * 1000,
              );
            } catch (_) {
              return null;
            }
          }),
        ),
      );
      if (mounted) setState(() => _prepared = out.length);
    }
    return out.whereType<PickedMedia>().toList();
  }

  /// true = skip duplicates, false = upload anyway, null = cancel.
  Future<bool?> _askAboutDuplicates(List<PickedMedia> repeated, int total) {
    final p = DsColors.of(context);
    return showModalBottomSheet<bool>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('${plural(repeated.length, 'file')} already here', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 6),
              Text(
                '${repeated.length == total ? 'All of them have' : '${repeated.length} of $total have'} the same name, size and date as files already in this event (or already uploading).',
                style: Theme.of(context).textTheme.bodyLarge!.copyWith(color: p.tx2),
              ),
              const SizedBox(height: 12),
              ConstrainedBox(
                constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.3),
                child: ListView(
                  shrinkWrap: true,
                  children: [
                    for (final f in repeated.take(200))
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: Row(
                          children: [
                            Icon(f.isVideo ? Icons.movie_outlined : Icons.photo_outlined, size: 18, color: p.tx3),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                f.name,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(fontFamily: Ds.mono, fontSize: 13),
                              ),
                            ),
                            Text(
                              formatBytes(f.size),
                              style: TextStyle(color: p.tx3, fontSize: 12, fontFeatures: Ds.tabular),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              FilledButton(
                style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                onPressed: () => Navigator.pop(context, true),
                child: Text(repeated.length == total ? 'Skip them' : 'Skip duplicates · upload ${total - repeated.length}'),
              ),
              const SizedBox(height: 8),
              OutlinedButton(
                style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                onPressed: () => Navigator.pop(context, false),
                child: Text('Upload all $total anyway'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Android 13+: the progress notification (and so the background upload) needs this.
  Future<void> _askForNotifications() async {
    final perms = FileDownloader().permissions;
    if (await perms.status(PermissionType.notifications) != PermissionStatus.granted) {
      await perms.request(PermissionType.notifications);
    }
  }

  Future<void> _retry(UploadEntry e) async {
    try {
      await uploads.retry(e);
    } on ApiException catch (err) {
      if (mounted) toast(context, err.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = DsColors.of(context);
    final event = widget.event;
    return ListenableBuilder(
      listenable: uploads,
      builder: (context, _) {
        final items = uploads.forEvent(event.id).reversed.toList();
        int count(bool Function(UploadEntry) f) => items.where(f).length;
        final sent = count((e) => !e.active && e.stage != UploadStage.failed);
        final done = count((e) => e.stage == UploadStage.done);
        final failed = count((e) => e.stage == UploadStage.failed);
        final matched = count((e) => e.matches > 0);
        final waiting = count((e) => e.active);

        return Scaffold(
          appBar: AppBar(
            title: const Text('Add photos & videos'),
            actions: [if (done + failed > 0) TextButton(onPressed: () => uploads.clearFinished(event.id), child: const Text('Clear finished'))],
          ),
          floatingActionButton: _preparing
              ? null
              : FloatingActionButton.extended(
                  icon: const Icon(Icons.add_photo_alternate_outlined),
                  label: Text(items.isEmpty ? 'Choose from gallery' : 'Add more'),
                  onPressed: _pick,
                ),
          body: CustomScrollView(
            slivers: [
              SliverPadding(
                padding: EdgeInsets.fromLTRB(Ds.pagePad(context), 4, Ds.pagePad(context), 0),
                sliver: SliverList.list(
                  children: [
                    Text(
                      'Originals are saved to ${event.storageFolderName != null ? '“${event.storageFolderName}”' : 'the event\'s storage'}. '
                      'Photos are scanned for faces; videos are stored as they are. Uploads keep going if you leave the app.',
                      style: Theme.of(context).textTheme.bodyMedium!.copyWith(color: p.tx3),
                    ),
                    if (event.canViewAll && event.folders.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      DsLabel(
                        'Add to album',
                        child: DropdownButtonFormField<String?>(
                          initialValue: _folderId,
                          borderRadius: BorderRadius.circular(Ds.rLg),
                          dropdownColor: p.sf,
                          icon: Icon(Icons.expand_more, size: 20, color: p.tx2),
                          items: [
                            const DropdownMenuItem<String?>(value: null, child: Text('No album')),
                            for (final f in event.folders) DropdownMenuItem<String?>(value: f.id, child: Text(f.name)),
                          ],
                          onChanged: (v) => setState(() => _folderId = v),
                        ),
                      ),
                    ],
                    const SizedBox(height: 16),
                    if (_preparing)
                      // Processing card (§7.11): a title, a counter, a 6 px bar.
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                _prepared < _preparingTotal ? 'Reading $_prepared of $_preparingTotal…' : 'Checking for duplicates…',
                                style: Theme.of(context).textTheme.titleSmall!.copyWith(fontFeatures: Ds.tabular),
                              ),
                              const SizedBox(height: 12),
                              LinearProgressIndicator(value: _preparingTotal == 0 ? null : _prepared / _preparingTotal),
                            ],
                          ),
                        ),
                      ),
                    if (items.isEmpty && !_preparing)
                      EmptyView(
                        icon: Icons.add_photo_alternate_outlined,
                        title: 'Choose photos and videos',
                        body: 'Pick as many as you like — whole albums at once.',
                        action: FilledButton.icon(onPressed: _pick, icon: const Icon(Icons.photo_library_outlined), label: const Text('Open gallery')),
                      )
                    else if (items.isNotEmpty) ...[
                      Wrap(
                        spacing: 20,
                        runSpacing: 8,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          _Stat(value: items.length, label: 'selected'),
                          _Stat(value: sent, label: 'uploaded'),
                          _Stat(value: done, label: 'finished'),
                          _Stat(value: matched, label: 'with you or family', color: p.ac),
                          if (failed > 0) _Stat(value: failed, label: 'failed', color: p.crit),
                          if (waiting > 0) TextButton(onPressed: () => uploads.cancelWaiting(event.id), child: Text('Cancel $waiting waiting')),
                        ],
                      ),
                      const SizedBox(height: 12),
                    ],
                  ],
                ),
              ),
              // Lazily built: a batch can be thousands of files.
              SliverPadding(
                padding: EdgeInsets.fromLTRB(Ds.pagePad(context), 0, Ds.pagePad(context), 96),
                sliver: SliverList.separated(
                  itemCount: items.length,
                  separatorBuilder: (_, _) => const Divider(),
                  itemBuilder: (_, i) => _Row(entry: items[i], onRetry: () => _retry(items[i])),
                ),
              ),
            ],
          ),
        );
      },
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
    // Inline KPI (§7.10): a 17/600 tabular value with its words after it.
    final p = DsColors.of(context);
    return Text.rich(
      TextSpan(
        children: [
          TextSpan(
            text: '${NumberFormat.decimalPattern().format(value)} ',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(color: color ?? p.tx, fontFeatures: Ds.tabular),
          ),
          TextSpan(
            text: label,
            style: TextStyle(fontSize: 13, color: color ?? p.tx3),
          ),
        ],
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.entry, required this.onRetry});
  final UploadEntry entry;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final p = DsColors.of(context);
    final e = entry;
    final status = switch (e.stage) {
      UploadStage.queued => const DsBadge('Waiting'),
      UploadStage.uploading => DsBadge('Uploading ${(e.progress * 100).round()}%'),
      UploadStage.received => const DsBadge('Queued on server'),
      UploadStage.storing => const DsBadge('Saving to storage…'),
      UploadStage.processing => const DsBadge('Making previews…'),
      UploadStage.findingFaces => const DsBadge('Finding faces…', tone: DsTone.warn, icon: Icons.face),
      UploadStage.done when e.isVideo => const DsBadge('Stored', tone: DsTone.good, icon: Icons.check_circle),
      UploadStage.done when e.error != null => DsBadge(e.error!, tone: DsTone.warn),
      UploadStage.done when e.matches > 0 => const DsBadge('Matched', tone: DsTone.accent, icon: Icons.check_circle),
      UploadStage.done => DsBadge(e.faces != null && e.faces! > 0 ? plural(e.faces!, 'face') : 'No faces', tone: DsTone.good),
      UploadStage.failed => const DsBadge('Failed', tone: DsTone.crit, icon: Icons.error_outline),
    };
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Row(
        children: [
          _Thumb(entry: e),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // File names are machine strings: Plex Mono (§4.1).
                Text(
                  e.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontFamily: Ds.mono, fontSize: 13, height: 18 / 13),
                ),
                const SizedBox(height: 2),
                Text(
                  e.stage == UploadStage.failed ? (e.error ?? 'Failed') : formatBytes(e.size),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 12, height: 16 / 12, color: e.stage == UploadStage.failed ? p.crit : p.tx3, fontFeatures: Ds.tabular),
                ),
                if (e.stage == UploadStage.uploading) ...[const SizedBox(height: 6), LinearProgressIndicator(value: e.progress)],
              ],
            ),
          ),
          const SizedBox(width: 8),
          Flexible(child: status),
          if (e.stage == UploadStage.failed || (e.stage == UploadStage.done && e.error != null))
            IconButton(tooltip: 'Retry', icon: const Icon(Icons.refresh), onPressed: onRetry),
        ],
      ),
    );
  }
}

/// Gallery thumbnail for a queued file (looked up by its photo_manager id).
class _Thumb extends StatefulWidget {
  const _Thumb({required this.entry});
  final UploadEntry entry;

  @override
  State<_Thumb> createState() => _ThumbState();
}

class _ThumbState extends State<_Thumb> {
  late final Future<AssetEntity?> _asset = AssetEntity.fromId(widget.entry.assetId);

  @override
  Widget build(BuildContext context) {
    final p = DsColors.of(context);
    final placeholder = ColoredBox(
      color: p.sunk,
      child: Icon(widget.entry.isVideo ? Icons.movie_outlined : Icons.photo_outlined, size: 20, color: p.tx3),
    );
    return ClipRRect(
      borderRadius: BorderRadius.circular(Ds.rMd),
      child: SizedBox(
        width: 48,
        height: 48,
        child: FutureBuilder<AssetEntity?>(
          future: _asset,
          builder: (_, snap) => snap.data == null
              ? placeholder
              : AssetEntityImage(
                  snap.data!,
                  isOriginal: false,
                  thumbnailSize: const ThumbnailSize.square(144),
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => placeholder,
                ),
        ),
      ),
    );
  }
}
