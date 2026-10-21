import 'package:flutter/material.dart';
import 'package:photo_manager/photo_manager.dart';
import 'package:photo_manager_image_provider/photo_manager_image_provider.dart';

import '../theme.dart';
import '../widgets/common.dart';

enum _Kind { all, photos, videos }

/// InFrame's own gallery: albums, photos + videos, and no cap on how many can
/// be picked (the system picker stops at 100). Long-press and drag to select a
/// run of tiles. Pops with the chosen [AssetEntity]s.
class GalleryPicker extends StatefulWidget {
  const GalleryPicker({super.key});

  static Future<List<AssetEntity>?> open(BuildContext context) =>
      Navigator.push<List<AssetEntity>>(context, MaterialPageRoute(fullscreenDialog: true, builder: (_) => const GalleryPicker()));

  @override
  State<GalleryPicker> createState() => _GalleryPickerState();
}

class _GalleryPickerState extends State<GalleryPicker> with WidgetsBindingObserver {
  static const _pageSize = 240;
  static const _columns = 4;
  static const _gap = 2.0;

  PermissionState? _permission;
  List<AssetPathEntity> _albums = [];
  AssetPathEntity? _album;
  int _albumCount = 0;
  _Kind _kind = _Kind.all;

  final List<AssetEntity> _assets = [];
  bool _loading = false;
  bool _done = false;
  int _generation = 0;

  /// Selection keeps its order (the order things were picked in).
  final Map<String, AssetEntity> _selected = {};
  final _scroll = ScrollController();

  // Drag-select state
  int? _dragStart;
  bool _dragSelecting = true;
  Map<String, AssetEntity> _beforeDrag = {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _init();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _scroll.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Back from system settings / "select more photos": reload what we can see.
    if (state == AppLifecycleState.resumed) _init(keepAlbum: true);
  }

  Future<void> _init({bool keepAlbum = false}) async {
    final state = await PhotoManager.requestPermissionExtend();
    if (!mounted) return;
    setState(() => _permission = state);
    if (!state.hasAccess) return;
    await _loadAlbums(keepAlbum: keepAlbum);
  }

  RequestType get _type => switch (_kind) {
    _Kind.all => RequestType.common,
    _Kind.photos => RequestType.image,
    _Kind.videos => RequestType.video,
  };

  Future<void> _loadAlbums({bool keepAlbum = false}) async {
    final albums = await PhotoManager.getAssetPathList(
      type: _type,
      filterOption: FilterOptionGroup(orders: const [OrderOption(type: OrderOptionType.createDate, asc: false)]),
    );
    if (!mounted) return;
    final previous = keepAlbum ? _album?.id : null;
    setState(() {
      _albums = albums;
      _album = albums.where((a) => a.id == previous).firstOrNull ?? albums.firstOrNull;
    });
    await _reload();
  }

  Future<void> _reload() async {
    _generation++;
    setState(() {
      _assets.clear();
      _done = false;
      _loading = false;
      _albumCount = 0;
    });
    if (_scroll.hasClients) _scroll.jumpTo(0);
    final album = _album;
    if (album == null) {
      setState(() => _done = true);
      return;
    }
    final count = await album.assetCountAsync;
    if (mounted) setState(() => _albumCount = count);
    await _loadMore();
  }

  Future<void> _loadMore() async {
    final album = _album;
    if (_loading || _done || album == null) return;
    _loading = true;
    final gen = _generation;
    final page = await album.getAssetListPaged(page: _assets.length ~/ _pageSize, size: _pageSize);
    if (!mounted || gen != _generation) return;
    setState(() {
      _assets.addAll(page);
      _done = page.length < _pageSize;
      _loading = false;
    });
  }

  void _toggle(AssetEntity a) => setState(() => _selected.containsKey(a.id) ? _selected.remove(a.id) : _selected[a.id] = a);

  Future<void> _selectAll() async {
    final album = _album;
    if (album == null) return;
    final everything = await album.getAssetListRange(start: 0, end: _albumCount);
    if (!mounted) return;
    final allSelected = everything.every((a) => _selected.containsKey(a.id));
    setState(() {
      for (final a in everything) {
        allSelected ? _selected.remove(a.id) : _selected[a.id] = a;
      }
    });
  }

  // ─── Long-press + drag selection ──────────────────────────────────────
  int? _indexAt(Offset local, double width) {
    final tile = (width - _gap * (_columns - 1)) / _columns;
    final y = local.dy + _scroll.offset;
    final row = (y / (tile + _gap)).floor();
    final col = (local.dx / (tile + _gap)).floor().clamp(0, _columns - 1);
    final i = row * _columns + col;
    return i >= 0 && i < _assets.length ? i : null;
  }

  void _dragTo(int index) {
    final start = _dragStart;
    if (start == null) return;
    final lo = start < index ? start : index, hi = start < index ? index : start;
    setState(() {
      _selected
        ..clear()
        ..addAll(_beforeDrag);
      for (var i = lo; i <= hi; i++) {
        final a = _assets[i];
        _dragSelecting ? _selected[a.id] = a : _selected.remove(a.id);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final p = DsColors.of(context);
    final state = _permission;
    final limited = state == PermissionState.limited;

    return Scaffold(
      appBar: AppBar(
        title: Text(_selected.isEmpty ? 'Choose photos & videos' : '${_selected.length} selected'),
        actions: [
          if (_albumCount > 0) TextButton(onPressed: _selectAll, child: const Text('Select all')),
          if (_selected.isNotEmpty) IconButton(tooltip: 'Clear selection', icon: const Icon(Icons.deselect), onPressed: () => setState(_selected.clear)),
        ],
      ),
      body: switch (state) {
        null => const Center(child: CircularProgressIndicator()),
        _ when !state.hasAccess => EmptyView(
          icon: Icons.photo_library_outlined,
          title: 'Allow access to your photos',
          body: 'InFrame needs to see your photos and videos to upload them.',
          action: FilledButton(onPressed: PhotoManager.openSetting, child: const Text('Open settings')),
        ),
        _ => Column(
          children: [
            if (limited)
              // Neutral callout (§7.5) with a trailing action.
              Padding(
                padding: EdgeInsets.fromLTRB(Ds.pagePad(context), 4, Ds.pagePad(context), 4),
                child: Container(
                  padding: const EdgeInsets.fromLTRB(14, 4, 4, 4),
                  decoration: BoxDecoration(color: p.sunk, borderRadius: BorderRadius.circular(Ds.rLg)),
                  child: Row(
                    children: [
                      Icon(Icons.info_outline, size: 18, color: p.tx2),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text("You've shared only some photos with InFrame.", style: Theme.of(context).textTheme.bodySmall!.copyWith(color: p.tx2)),
                      ),
                      TextButton(onPressed: PhotoManager.presentLimited, child: const Text('Add more')),
                    ],
                  ),
                ),
              ),
            SizedBox(
              height: 52,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: EdgeInsets.symmetric(horizontal: Ds.pagePad(context)),
                children: [
                  for (final k in _Kind.values)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: DsChoiceChip(
                        label: switch (k) {
                          _Kind.all => 'All',
                          _Kind.photos => 'Photos',
                          _Kind.videos => 'Videos',
                        },
                        selected: _kind == k,
                        onSelected: () {
                          setState(() => _kind = k);
                          _loadAlbums(keepAlbum: true);
                        },
                      ),
                    ),
                  VerticalDivider(width: 16, indent: 14, endIndent: 14, color: p.ln2),
                  for (final a in _albums)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: DsChoiceChip(
                        label: a.isAll ? 'Recents' : a.name,
                        selected: _album?.id == a.id,
                        onSelected: () {
                          setState(() => _album = a);
                          _reload();
                        },
                      ),
                    ),
                ],
              ),
            ),
            Expanded(
              child: _assets.isEmpty && _done
                  ? const EmptyView(icon: Icons.photo_outlined, title: 'Nothing here', body: 'This album has no photos or videos.')
                  : LayoutBuilder(
                      builder: (context, box) {
                        return GestureDetector(
                          onLongPressStart: (d) {
                            final i = _indexAt(d.localPosition, box.maxWidth);
                            if (i == null) return;
                            _dragStart = i;
                            _beforeDrag = Map.of(_selected);
                            _dragSelecting = !_selected.containsKey(_assets[i].id);
                            _dragTo(i);
                          },
                          onLongPressMoveUpdate: (d) {
                            final i = _indexAt(d.localPosition, box.maxWidth);
                            if (i != null) _dragTo(i);
                            // Near the top/bottom edge: keep scrolling so long runs can be selected.
                            const edge = 60.0;
                            if (d.localPosition.dy > box.maxHeight - edge) {
                              _scroll.jumpTo((_scroll.offset + 14).clamp(0, _scroll.position.maxScrollExtent));
                            } else if (d.localPosition.dy < edge) {
                              _scroll.jumpTo((_scroll.offset - 14).clamp(0, _scroll.position.maxScrollExtent));
                            }
                          },
                          onLongPressEnd: (_) => _dragStart = null,
                          child: GridView.builder(
                            controller: _scroll,
                            padding: const EdgeInsets.only(bottom: 96),
                            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                              crossAxisCount: _columns,
                              mainAxisSpacing: _gap,
                              crossAxisSpacing: _gap,
                            ),
                            itemCount: _assets.length,
                            itemBuilder: (context, i) {
                              if (i >= _assets.length - 60) _loadMore();
                              final a = _assets[i];
                              return _Tile(asset: a, selected: _selected.containsKey(a.id), onTap: () => _toggle(a));
                            },
                          ),
                        );
                      },
                    ),
            ),
          ],
        ),
      },
      bottomNavigationBar: _selected.isEmpty
          ? null
          : DecoratedBox(
              decoration: BoxDecoration(
                color: p.sf,
                border: Border(top: BorderSide(color: p.ln)),
              ),
              child: SafeArea(
                child: Padding(
                  padding: EdgeInsets.fromLTRB(Ds.pagePad(context), 12, Ds.pagePad(context), 12),
                  child: FilledButton.icon(
                    style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                    icon: const Icon(Icons.cloud_upload_outlined),
                    label: Text('Upload ${plural(_selected.length, 'file')}'),
                    onPressed: () => Navigator.pop(context, _selected.values.toList()),
                  ),
                ),
              ),
            ),
    );
  }
}

class _Tile extends StatelessWidget {
  const _Tile({required this.asset, required this.selected, required this.onTap});
  final AssetEntity asset;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = DsColors.of(context);
    final isVideo = asset.type == AssetType.video;
    return GestureDetector(
      onTap: onTap,
      child: Stack(
        fit: StackFit.expand,
        children: [
          AnimatedPadding(
            duration: const Duration(milliseconds: 110),
            padding: EdgeInsets.all(selected ? 7 : 0),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(selected ? Ds.rMd : 0),
              child: AssetEntityImage(
                asset,
                isOriginal: false,
                thumbnailSize: const ThumbnailSize.square(240),
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) => ColoredBox(
                  color: p.sunk,
                  child: Icon(Icons.broken_image_outlined, color: p.tx3),
                ),
                frameBuilder: (_, child, frame, sync) => frame == null && !sync ? ColoredBox(color: p.sunk) : child,
              ),
            ),
          ),
          if (isVideo)
            Positioned(
              right: 4,
              bottom: 4,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(4)),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.play_arrow_rounded, size: 13, color: Colors.white),
                    Text(
                      formatDuration(asset.videoDuration),
                      style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w600, fontFeatures: Ds.tabular),
                    ),
                  ],
                ),
              ),
            ),
          Positioned(
            left: 5,
            top: 5,
            child: Container(
              width: 22,
              height: 22,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: selected ? p.ac : Colors.black26,
                border: Border.all(color: Colors.white, width: 2),
              ),
              child: selected ? Icon(Icons.check, size: 14, color: p.acTx) : null,
            ),
          ),
        ],
      ),
    );
  }
}
