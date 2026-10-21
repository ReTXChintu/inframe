import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api.dart';
import '../api/models.dart';
import '../state/session.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/photos.dart';
import '../widgets/selfie.dart';
import '../widgets/trippin.dart';
import 'connect_storage_screen.dart';
import 'event_settings_screen.dart';
import 'share_sheet.dart';
import 'upload_screen.dart';

/// One event's gallery: All / You / family / Favourites / Your uploads / albums.
class EventScreen extends StatefulWidget {
  const EventScreen({super.key, required this.eventId});
  final String eventId;

  @override
  State<EventScreen> createState() => _EventScreenState();
}

class _View {
  const _View(this.kind, [this.id]);
  final String kind; // all | me | person | favorites | uploads | folder
  final String? id;
  String get key => id == null ? kind : '$kind:$id';
}

class _EventScreenState extends State<EventScreen> {
  EventDetail? _event;
  String? _error;
  _View _view = const _View('all');
  bool _newestFirst = true;
  late final PhotoFeed _feed = PhotoFeed(_path)..addListener(_onFeed);
  final Set<String> _selected = {};

  String get _path {
    final base = '/api/events/${widget.eventId}/photos?order=${_newestFirst ? 'newest' : 'oldest'}&view=${_view.kind}';
    return switch (_view.kind) {
      'person' => '$base&personId=${_view.id}',
      'folder' => '$base&folderId=${_view.id}',
      _ => base,
    };
  }

  void _onFeed() => setState(() {});

  @override
  void initState() {
    super.initState();
    _load(first: true);
  }

  @override
  void dispose() {
    _feed.removeListener(_onFeed);
    super.dispose();
  }

  Future<void> _load({bool first = false}) async {
    try {
      final res = await api.get<Map<String, dynamic>>('/api/events/${widget.eventId}');
      final event = EventDetail(Map<String, dynamic>.from(res['event'] as Map));
      if (!mounted) return;
      setState(() {
        _event = event;
        _error = null;
      });
      if (first) {
        // Default: full gallery if allowed, else your matches, else favourites.
        _view = event.canViewAll
            ? const _View('all')
            : event.canFaceSearch
            ? const _View('me')
            : const _View('favorites');
        await _feed.refresh(_path);
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _refresh() async {
    await Future.wait([_load(), _feed.refresh(_path)]);
  }

  void _setView(_View v) {
    setState(() {
      _view = v;
      _selected.clear();
    });
    _feed.refresh(_path);
  }

  void _toggle(Photo photo) => setState(() => _selected.contains(photo.id) ? _selected.remove(photo.id) : _selected.add(photo.id));

  Future<void> _open(int index) async {
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => PhotoViewer(feed: _feed, initialIndex: index),
      ),
    );
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final p = DsColors.of(context);
    final pad = Ds.pagePad(context);
    final event = _event;
    if (event == null) {
      return Scaffold(
        appBar: AppBar(),
        body: Center(
          child: _error != null ? EmptyView(icon: Icons.photo_library_outlined, title: 'Event not available', body: _error) : const CircularProgressIndicator(),
        ),
      );
    }
    final self = event.self;
    final family = event.people.where((x) => !x.isSelf && x.hasSelfie).toList();
    final myId = context.watch<Session>().me?.user.id;
    final selectedPhotos = _feed.items.where((x) => _selected.contains(x.id)).toList();
    final canDeleteSelection = event.isHost || selectedPhotos.every((x) => x.uploaderId == myId);

    final views = <(_View, String, int?)>[
      if (event.canViewAll) (const _View('all'), 'All photos', event.count('all')),
      if (event.canFaceSearch && (self?.hasSelfie ?? false)) (const _View('me'), 'You', event.count('me')),
      if (event.canFaceSearch)
        for (final f in family) (_View('person', f.id), f.name, f.eventCount),
      (const _View('favorites'), 'Favourites', event.count('favorites')),
      if (event.canUpload || (event.count('uploads') ?? 0) > 0) (const _View('uploads'), 'Your uploads', event.count('uploads')),
      if (event.canViewAll)
        for (final f in event.folders) (_View('folder', f.id), f.name, f.count),
    ];

    return Scaffold(
      appBar: _selected.isEmpty
          ? AppBar(
              title: Text(event.name, overflow: TextOverflow.ellipsis),
              actions: [
                IconButton(tooltip: 'Invite people', icon: const Icon(Icons.person_add_alt), onPressed: () => showShareSheet(context, event)),
                IconButton(
                  tooltip: event.isHost ? 'Event settings' : 'Event details',
                  icon: const Icon(Icons.tune),
                  onPressed: () async {
                    final left = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => EventSettingsScreen(eventId: event.id)));
                    if (left == true && context.mounted) {
                      Navigator.pop(context);
                    } else {
                      _refresh();
                    }
                  },
                ),
              ],
            )
          : AppBar(
              leading: IconButton(tooltip: 'Clear selection', icon: const Icon(Icons.close), onPressed: () => setState(_selected.clear)),
              title: Text('${_selected.length} selected'),
              actions: [
                IconButton(
                  tooltip: 'Favourite',
                  icon: const Icon(Icons.favorite_border),
                  onPressed: () async {
                    final allFav = selectedPhotos.every((x) => x.favorite);
                    try {
                      await setFavorite(_selected.toList(), !allFav);
                      setState(_selected.clear);
                      _refresh();
                    } on ApiException catch (e) {
                      if (context.mounted) toast(context, e.message, error: true);
                    }
                  },
                ),
                IconButton(tooltip: 'Save to phone', icon: const Icon(Icons.download_outlined), onPressed: () => saveToGallery(context, selectedPhotos)),
                if (canDeleteSelection)
                  IconButton(
                    tooltip: 'Delete',
                    icon: const Icon(Icons.delete_outline),
                    onPressed: () async {
                      try {
                        final deleted = await deletePhotos(context, _selected.toList());
                        if (deleted.isEmpty) return;
                        _feed.removeIds(deleted);
                        setState(_selected.clear);
                        _load();
                      } on ApiException catch (e) {
                        if (context.mounted) toast(context, e.message, error: true);
                      }
                    },
                  ),
              ],
            ),
      floatingActionButton: event.canUpload && !event.storagePending && _selected.isEmpty
          ? FloatingActionButton.extended(
              icon: const Icon(Icons.add_photo_alternate_outlined),
              label: const Text('Add photos'),
              onPressed: () async {
                await Navigator.push(context, MaterialPageRoute(builder: (_) => UploadScreen(event: event)));
                _refresh();
              },
            )
          : null,
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: CustomScrollView(
          slivers: [
            SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.fromLTRB(pad, 4, pad, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      [
                        kindLabels[event.kind],
                        formatRange(event.startsOn, event.endsOn),
                        plural(event.count('members') ?? 0, 'member'),
                      ].whereType<String>().join(' · '),
                      style: Theme.of(context).textTheme.labelMedium!.copyWith(fontFeatures: Ds.tabular),
                    ),
                    if (event.external case final link? when link.isTrippin) ...[const SizedBox(height: 10), TrippinChip(link)],
                    if (event.storagePending) ...[
                      const SizedBox(height: 14),
                      StoragePendingBanner(
                        isOwner: event.isOwner,
                        onConnect: () async {
                          final connected = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => ConnectStorageScreen(event: event)));
                          if (connected == true) _refresh();
                        },
                      ),
                    ] else if (event.isHost && !event.storageConnected) ...[
                      const SizedBox(height: 10),
                      DsBadge('No storage folder connected — uploads are off', tone: DsTone.warn, icon: Icons.warning_amber),
                    ],
                    if (event.isHost && (event.count('processing') ?? 0) > 0) ...[
                      const SizedBox(height: 10),
                      DsBadge('Processing ${plural(event.count('processing')!, 'photo')}', icon: Icons.sync),
                    ],
                    const SizedBox(height: 14),
                    if (event.canFaceSearch && self != null && !self.hasSelfie)
                      _Banner(
                        icon: Icons.face_retouching_natural,
                        title: "Find the photos you're in",
                        body: 'Take a quick selfie. InFrame checks every photo in this event — and every new one.',
                        action: 'Take a selfie',
                        onTap: () async {
                          if (await captureSelfie(context, self)) {
                            _refresh();
                            if (context.mounted) context.read<Session>().reloadMe();
                          }
                        },
                      )
                    else if (event.canFaceSearch && (event.count('me') ?? 0) > 0 && _view.kind != 'me')
                      _Banner(
                        icon: Icons.auto_awesome,
                        title: "You're in ${plural(event.count('me')!, 'photo')}",
                        body: 'Tap to see them all.',
                        onTap: () => _setView(const _View('me')),
                      ),
                  ],
                ),
              ),
            ),
            SliverToBoxAdapter(
              // Chip rows scroll horizontally rather than wrap (§6.3).
              child: SizedBox(
                height: 48,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: EdgeInsets.symmetric(horizontal: pad),
                  children: [
                    for (final (v, label, count) in views)
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: DsChoiceChip(selected: _view.key == v.key, label: label, count: count, onSelected: () => _setView(v)),
                      ),
                  ],
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.fromLTRB(pad, 0, pad - 8, 2),
                child: Row(
                  children: [
                    Text(
                      _feed.items.isEmpty ? '' : '${plural(_feed.items.length, 'photo')}${_feed.done ? '' : '+'}',
                      style: TextStyle(color: p.tx3, fontSize: 13, fontFeatures: Ds.tabular),
                    ),
                    const Spacer(),
                    TextButton.icon(
                      icon: Icon(_newestFirst ? Icons.arrow_downward : Icons.arrow_upward, size: 16),
                      label: Text(_newestFirst ? 'Newest first' : 'Oldest first'),
                      onPressed: () {
                        setState(() => _newestFirst = !_newestFirst);
                        _feed.refresh(_path);
                      },
                    ),
                  ],
                ),
              ),
            ),
            if (_feed.items.isEmpty && !_feed.loading)
              SliverToBoxAdapter(
                child: _feed.error != null
                    ? Padding(padding: const EdgeInsets.all(16), child: ErrorBox(_feed.error))
                    : EmptyView(
                        icon: _view.kind == 'me' ? Icons.face_outlined : Icons.photo_library_outlined,
                        title: switch (_view.kind) {
                          'me' => 'No photos of you yet',
                          'favorites' => 'No favourites',
                          'uploads' => "You haven't added photos",
                          _ => 'No photos yet',
                        },
                        body: switch (_view.kind) {
                          'me' => 'As soon as someone adds a photo you\'re in, it shows up here.',
                          'favorites' => 'Tap the heart on a photo to keep it here.',
                          _ when event.storagePending =>
                            event.isOwner ? 'Connect a folder to start adding photos.' : 'Photos will appear once the owner connects a folder.',
                          _ => event.canUpload ? 'Be the first to add some.' : null,
                        },
                      ),
              )
            else
              PhotoGridSliver(feed: _feed, selected: _selected, onTap: _open, onToggle: _toggle),
            if (_feed.loading)
              const SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.all(24),
                  child: Center(child: CircularProgressIndicator()),
                ),
              ),
            const SliverToBoxAdapter(child: SizedBox(height: 96)),
          ],
        ),
      ),
    );
  }
}

/// An info callout (§7.5): ac-soft, an icon tile, and either a primary
/// action button under the text or a trailing chevron when the whole row is the link.
class _Banner extends StatelessWidget {
  const _Banner({required this.icon, required this.title, required this.body, required this.onTap, this.action});
  final IconData icon;
  final String title;
  final String body;
  final String? action;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = DsColors.of(context);
    return DsCallout(
      icon: icon,
      title: title,
      body: body,
      onTap: onTap,
      trailing: action == null
          ? Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Icon(Icons.chevron_right, size: 20, color: p.ac),
            )
          : null,
      action: action == null
          ? null
          : FilledButton(
              style: FilledButton.styleFrom(minimumSize: const Size(0, 40), padding: const EdgeInsets.symmetric(horizontal: 16)),
              onPressed: onTap,
              child: Text(action!),
            ),
    );
  }
}
