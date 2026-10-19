import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:gal/gal.dart';
import 'package:intl/intl.dart';

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
      final bytes = await api.bytes(p.originalUrl!);
      await Gal.putImageBytes(Uint8List.fromList(bytes), album: 'InFrame', name: p.originalName.replaceAll(RegExp(r'\.[^.]+$'), ''));
      saved++;
    }
    if (context.mounted) toast(context, 'Saved ${plural(saved, 'photo')} to your gallery.');
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
          ('Faces', photo.faceStatus == 'done' ? '${photo.faceCount}' : photo.faceStatus == 'failed' ? "Couldn't scan" : 'Scanning…'),
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
