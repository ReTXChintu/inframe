import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:gal/gal.dart';
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';
import 'package:video_player/video_player.dart';

import '../api/api.dart';
import '../api/models.dart';
import '../theme.dart';
import 'common.dart';

/// Keyset-paginated photo listing (`{items, nextCursor}`) for any endpoint.
class PhotoFeed extends ChangeNotifier {
  PhotoFeed(this.path);

  /// Endpoint with its query string, e.g. `/api/events/ID/photos?view=all`.
  String path;
  final List<Photo> items = [];
  String? _cursor;
  bool loading = false;
  bool done = false;
  String? error;
  int _generation = 0;

  Future<void> refresh([String? newPath]) async {
    if (newPath != null) path = newPath;
    _generation++;
    items.clear();
    _cursor = null;
    done = false;
    error = null;
    loading = false;
    notifyListeners();
    await loadMore();
  }

  Future<void> loadMore() async {
    if (loading || done) return;
    loading = true;
    final gen = _generation;
    notifyListeners();
    try {
      final sep = path.contains('?') ? '&' : '?';
      final res = await api.get<Map<String, dynamic>>(
        '$path${_cursor != null ? '${sep}cursor=${Uri.encodeComponent(_cursor!)}' : ''}',
      );
      if (gen != _generation) return; // a newer refresh started
      final page = PhotoPage(res);
      items.addAll(page.items);
      _cursor = page.nextCursor;
      done = page.nextCursor == null;
      error = null;
    } on ApiException catch (e) {
      if (gen == _generation) error = e.message;
    } finally {
      if (gen == _generation) {
        loading = false;
        notifyListeners();
      }
    }
  }

  void replace(Photo photo) {
    final i = items.indexWhere((p) => p.id == photo.id);
    if (i >= 0) {
      items[i] = photo;
      notifyListeners();
    }
  }

  void removeIds(Set<String> ids) {
    items.removeWhere((p) => ids.contains(p.id));
    notifyListeners();
  }
}

/// Sliver grid of thumbnails with long-press multi-select.
class PhotoGridSliver extends StatelessWidget {
  const PhotoGridSliver({
    super.key,
    required this.feed,
    required this.selected,
    required this.onTap,
    required this.onToggle,
    this.showEvent = false,
  });

  final PhotoFeed feed;
  final Set<String> selected;
  final void Function(int index) onTap;
  final void Function(Photo photo) onToggle;
  final bool showEvent;

  @override
  Widget build(BuildContext context) {
    final p = Palette.of(context);
    final width = MediaQuery.sizeOf(context).width;
    final columns = width > 900 ? 6 : width > 600 ? 4 : 3;
    return SliverPadding(
      padding: const EdgeInsets.symmetric(horizontal: 2),
      sliver: SliverGrid.builder(
        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: columns, mainAxisSpacing: 2, crossAxisSpacing: 2),
        itemCount: feed.items.length,
        itemBuilder: (context, i) {
          if (i >= feed.items.length - 12) feed.loadMore();
          final photo = feed.items[i];
          final isSelected = selected.contains(photo.id);
          return GestureDetector(
            onTap: () => selected.isNotEmpty ? onToggle(photo) : onTap(i),
            onLongPress: () => onToggle(photo),
            child: Stack(fit: StackFit.expand, children: [
              AnimatedPadding(
                duration: const Duration(milliseconds: 120),
                padding: EdgeInsets.all(isSelected ? 8 : 0),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(isSelected ? 10 : 2),
                  child: NetImage(photo.thumbUrl, cacheKey: '${photo.id}:thumb'),
                ),
              ),
              if (photo.isVideo)
                Positioned(
                  right: 4,
                  top: 4,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                    decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(99)),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      const Icon(Icons.play_arrow_rounded, size: 13, color: Colors.white),
                      Text(
                        photo.durationMs != null ? formatDuration(Duration(milliseconds: photo.durationMs!)) : 'Video',
                        style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w600),
                      ),
                    ]),
                  ),
                ),
              if (showEvent && photo.eventName != null)
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 0,
                  child: Container(
                    padding: const EdgeInsets.fromLTRB(6, 14, 6, 4),
                    decoration: const BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Colors.transparent, Colors.black54])),
                    child: Text(photo.eventName!, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white, fontSize: 11)),
                  ),
                ),
              Positioned(
                right: 4,
                bottom: 4,
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  if (photo.people.isNotEmpty)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                      decoration: BoxDecoration(color: p.accent, borderRadius: BorderRadius.circular(99)),
                      child: Text(
                        photo.hasMe ? 'YOU' : '${photo.people.first['name']}'.split(' ').first.toUpperCase(),
                        style: TextStyle(color: p.accentInk, fontSize: 9, fontWeight: FontWeight.w800),
                      ),
                    ),
                  if (photo.favorite) const Padding(padding: EdgeInsets.only(left: 3), child: Icon(Icons.favorite, color: Colors.white, size: 15)),
                ]),
              ),
              if (selected.isNotEmpty)
                Positioned(
                  left: 6,
                  top: 6,
                  child: Container(
                    width: 22,
                    height: 22,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: isSelected ? p.accent : Colors.black26,
                      border: Border.all(color: Colors.white, width: 2),
                    ),
                    child: isSelected ? Icon(Icons.check, size: 14, color: p.accentInk) : null,
                  ),
                ),
            ]),
          );
        },
      ),
    );
  }
}

/// Favourite / delete a set of photos. Returns ids actually deleted (for delete).
Future<void> setFavorite(List<String> ids, bool value) =>
    api.post<dynamic>('/api/photos/favorite', {'photoIds': ids, 'favorite': value});

Future<Set<String>> deletePhotos(BuildContext context, List<String> ids) async {
  final ok = await confirm(
    context,
    title: 'Delete ${plural(ids.length, 'photo')}?',
    body: "They're removed for everyone in the event, and the files are moved to the trash of the event's storage folder.",
    action: 'Delete',
    danger: true,
  );
  if (!ok) return {};
  final res = await api.post<Map<String, dynamic>>('/api/photos/delete', {'photoIds': ids});
  final deleted = (res['deleted'] as List).map((e) => '$e').toSet();
  final failed = res['failed'] as List;
  if (context.mounted) {
    toast(context, failed.isNotEmpty ? "${plural(failed.length, 'photo')} couldn't be deleted." : 'Deleted ${plural(deleted.length, 'photo')}.',
        error: failed.isNotEmpty);
  }
  return deleted;
}

/// Download originals into the phone's gallery (album "InFrame").
Future<void> saveToGallery(BuildContext context, List<Photo> photos) async {
  try {
    if (!await Gal.hasAccess(toAlbum: true) && !await Gal.requestAccess(toAlbum: true)) {
      if (context.mounted) toast(context, 'Allow photo access to save pictures.', error: true);
      return;
    }
    var saved = 0;
    for (final p in photos) {
      if (p.originalUrl == null) continue;
      if (p.isVideo) {
        // Videos can be big: stream to a temp file instead of holding them in memory.
        final dir = await getTemporaryDirectory();
        final file = File('${dir.path}/${p.id}-${p.originalName.replaceAll(RegExp(r'[^\w.\-]'), '_')}');
        try {
          await api.downloadTo(p.originalUrl!, file.path);
          await Gal.putVideo(file.path, album: 'InFrame');
        } finally {
          if (await file.exists()) await file.delete();
        }
      } else {
        final bytes = await api.bytes(p.originalUrl!);
        await Gal.putImageBytes(Uint8List.fromList(bytes), album: 'InFrame', name: p.originalName.replaceAll(RegExp(r'\.[^.]+$'), ''));
      }
      saved++;
    }
    if (context.mounted) toast(context, 'Saved ${plural(saved, 'file')} to your gallery.');
  } catch (e) {
    if (context.mounted) toast(context, e is ApiException ? e.message : "Couldn't save to the gallery.", error: true);
  }
}

/// Full-screen swipeable viewer with pinch-zoom, favourite, save, delete and details.
class PhotoViewer extends StatefulWidget {
  const PhotoViewer({super.key, required this.feed, required this.initialIndex});
  final PhotoFeed feed;
  final int initialIndex;

  @override
  State<PhotoViewer> createState() => _PhotoViewerState();
}

class _PhotoViewerState extends State<PhotoViewer> {
  late final PageController _pages = PageController(initialPage: widget.initialIndex);
  late int _index = widget.initialIndex;
  bool _chrome = true;
  final _details = <String, Photo>{};

  Photo get _photo => widget.feed.items[_index];

  @override
  void initState() {
    super.initState();
    _loadDetail();
  }

  Future<void> _loadDetail() async {
    final id = _photo.id;
    if (_details.containsKey(id)) return;
    try {
      final res = await api.get<Map<String, dynamic>>('/api/photos/$id');
      if (mounted) setState(() => _details[id] = Photo(Map<String, dynamic>.from(res['photo'] as Map)));
    } on ApiException {
      // details are optional
    }
  }

  Future<void> _toggleFavorite() async {
    final photo = _photo;
    final value = !photo.favorite;
    widget.feed.replace(photo.copyWith({'favorite': value}));
    setState(() {});
    try {
      await setFavorite([photo.id], value);
    } on ApiException catch (e) {
      widget.feed.replace(photo);
      if (mounted) toast(context, e.message, error: true);
    }
  }

  Future<void> _delete() async {
    final photo = _photo;
    try {
      final deleted = await deletePhotos(context, [photo.id]);
      if (deleted.isEmpty || !mounted) return;
      widget.feed.removeIds(deleted);
      if (widget.feed.items.isEmpty) {
        Navigator.pop(context);
      } else {
        setState(() => _index = _index.clamp(0, widget.feed.items.length - 1));
      }
    } on ApiException catch (e) {
      if (mounted) toast(context, e.message, error: true);
    }
  }

  void _info() {
    final photo = _details[_photo.id] ?? _photo;
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (_) {
        final rows = <(String, String)>[
          ('Taken', photo.takenAt == null ? '—' : DateFormat('d MMM yyyy, h:mm a').format(photo.takenAt!)),
          ('Added by', photo.uploaderName ?? 'Storage folder'),
          if (photo.folderName != null) ('Album', photo.folderName!),
          ('Size', '${photo.width != null ? '${photo.width} × ${photo.height} · ' : ''}${formatBytes(photo.sizeBytes)}'),
          if (photo.isVideo && photo.durationMs != null) ('Length', formatDuration(Duration(milliseconds: photo.durationMs!))),
          (
            'Faces',
            switch (photo.faceStatus) {
              'skipped' => 'Not scanned (video)',
              'done' => '${photo.faceCount}',
              'failed' => "Couldn't scan",
              _ => 'Scanning…',
            }
          ),
        ];
        return Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 28),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(photo.originalName, style: Theme.of(context).textTheme.titleMedium),
            if (photo.people.isNotEmpty) ...[
              const SizedBox(height: 12),
              Wrap(spacing: 6, children: [
                for (final person in photo.people) Pill(person['kind'] == 'self' ? 'You' : '${person['name']}', tone: PillTone.accent),
              ]),
            ],
            const SizedBox(height: 14),
            for (final (k, v) in rows)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(children: [
                  SizedBox(width: 90, child: Text(k, style: TextStyle(color: Palette.of(context).muted))),
                  Expanded(child: Text(v)),
                ]),
              ),
          ]),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final feed = widget.feed;
    final photo = _photo;
    final canDelete = _details[photo.id]?.canDelete ?? false;
    return Scaffold(
      backgroundColor: const Color(0xFF0D0C10),
      body: Stack(children: [
        PageView.builder(
          controller: _pages,
          itemCount: feed.items.length,
          onPageChanged: (i) {
            setState(() => _index = i);
            if (i >= feed.items.length - 4) feed.loadMore().then((_) => mounted ? setState(() {}) : null);
            _loadDetail();
          },
          itemBuilder: (_, i) {
            final item = feed.items[i];
            if (item.isVideo) {
              return _VideoPage(
                key: ValueKey(item.id),
                photo: item,
                active: i == _index,
                onTap: () => setState(() => _chrome = !_chrome),
              );
            }
            return GestureDetector(
              onTap: () => setState(() => _chrome = !_chrome),
              child: InteractiveViewer(
                maxScale: 5,
                child: Center(child: NetImage(item.previewUrl, cacheKey: '${item.id}:preview', fit: BoxFit.contain)),
              ),
            );
          },
        ),
        AnimatedOpacity(
          opacity: _chrome ? 1 : 0,
          duration: const Duration(milliseconds: 150),
          child: IgnorePointer(
            ignoring: !_chrome,
            child: SafeArea(
              child: Column(children: [
                Row(children: [
                  IconButton(tooltip: 'Close', color: Colors.white, icon: const Icon(Icons.close), onPressed: () => Navigator.pop(context)),
                  Text('${_index + 1} of ${feed.items.length}${feed.done ? '' : '+'}', style: const TextStyle(color: Colors.white70)),
                  const Spacer(),
                  IconButton(
                    tooltip: photo.favorite ? 'Remove from favourites' : 'Add to favourites',
                    color: photo.favorite ? Palette.dark.accent : Colors.white,
                    icon: Icon(photo.favorite ? Icons.favorite : Icons.favorite_border),
                    onPressed: _toggleFavorite,
                  ),
                  IconButton(tooltip: 'Save to phone', color: Colors.white, icon: const Icon(Icons.download_outlined), onPressed: () => saveToGallery(context, [photo])),
                  if (canDelete) IconButton(tooltip: 'Delete', color: Colors.white, icon: const Icon(Icons.delete_outline), onPressed: _delete),
                  IconButton(tooltip: 'Details', color: Colors.white, icon: const Icon(Icons.info_outline), onPressed: _info),
                ]),
                const Spacer(),
                if (photo.people.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: Wrap(spacing: 6, children: [
                      for (final person in photo.people) Pill(person['kind'] == 'self' ? 'You' : '${person['name']}', tone: PillTone.accent),
                    ]),
                  ),
              ]),
            ),
          ),
        ),
      ]),
    );
  }
}

/// A video in the viewer: poster first, then streams the original (seeking
/// works through HTTP ranges) once the user taps play.
class _VideoPage extends StatefulWidget {
  const _VideoPage({super.key, required this.photo, required this.active, required this.onTap});
  final Photo photo;
  final bool active;
  final VoidCallback onTap;

  @override
  State<_VideoPage> createState() => _VideoPageState();
}

class _VideoPageState extends State<_VideoPage> {
  VideoPlayerController? _video;
  bool _failed = false;

  @override
  void didUpdateWidget(_VideoPage old) {
    super.didUpdateWidget(old);
    // Swiped away: stop, and free the decoder.
    if (!widget.active && _video != null) {
      _video!.dispose();
      _video = null;
    }
  }

  @override
  void dispose() {
    _video?.dispose();
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  Future<void> _play() async {
    final url = widget.photo.originalUrl;
    if (url == null) return;
    final c = VideoPlayerController.networkUrl(Uri.parse(api.resolve(url)));
    setState(() {
      _video = c;
      _failed = false;
    });
    try {
      await c.initialize();
      c.addListener(_changed);
      await c.play();
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    }
    _changed();
  }

  @override
  Widget build(BuildContext context) {
    final c = _video;
    final ready = c != null && c.value.isInitialized;
    return GestureDetector(
      onTap: widget.onTap,
      child: Stack(alignment: Alignment.center, children: [
        if (ready)
          Center(child: AspectRatio(aspectRatio: c.value.aspectRatio, child: VideoPlayer(c)))
        else
          Positioned.fill(child: NetImage(widget.photo.previewUrl, cacheKey: '${widget.photo.id}:preview', fit: BoxFit.contain)),
        if (_failed)
          const Text("Couldn't play this video.", style: TextStyle(color: Colors.white70))
        else if (c != null && !ready)
          const CircularProgressIndicator(color: Colors.white70)
        else if (!ready || !c.value.isPlaying)
          IconButton.filled(
            iconSize: 44,
            style: IconButton.styleFrom(backgroundColor: Colors.black54, foregroundColor: Colors.white),
            tooltip: 'Play',
            icon: const Icon(Icons.play_arrow_rounded),
            onPressed: widget.photo.originalUrl == null ? null : () => ready ? c.play() : _play(),
          ),
        if (ready)
          Positioned(
            left: 8,
            right: 16,
            bottom: 72,
            child: SafeArea(
              child: Row(children: [
                IconButton(
                  color: Colors.white,
                  tooltip: c.value.isPlaying ? 'Pause' : 'Play',
                  icon: Icon(c.value.isPlaying ? Icons.pause_rounded : Icons.play_arrow_rounded),
                  onPressed: () => c.value.isPlaying ? c.pause() : c.play(),
                ),
                Expanded(
                  child: VideoProgressIndicator(
                    c,
                    allowScrubbing: true,
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    colors: VideoProgressColors(playedColor: Palette.dark.accent, bufferedColor: Colors.white38, backgroundColor: Colors.white12),
                  ),
                ),
                const SizedBox(width: 10),
                Text(
                  '${formatDuration(c.value.position)} / ${formatDuration(c.value.duration)}',
                  style: const TextStyle(color: Colors.white70, fontSize: 12, fontFeatures: [FontFeature.tabularFigures()]),
                ),
              ]),
            ),
          ),
      ]),
    );
  }
}
