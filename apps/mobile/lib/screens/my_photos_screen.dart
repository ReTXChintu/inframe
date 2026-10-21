import 'package:flutter/material.dart';

import '../api/api.dart';
import '../api/models.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/photos.dart';

/// Every photo you (or a family member) are in, across all your events.
class MyPhotosScreen extends StatefulWidget {
  const MyPhotosScreen({super.key});

  @override
  State<MyPhotosScreen> createState() => _MyPhotosScreenState();
}

class _MyPhotosScreenState extends State<MyPhotosScreen> {
  List<Person>? _people;
  String? _personId;
  final PhotoFeed _feed = PhotoFeed('/api/me/photos');
  final Set<String> _selected = {};

  @override
  void initState() {
    super.initState();
    _feed.addListener(() => mounted ? setState(() {}) : null);
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await api.get<Map<String, dynamic>>('/api/people');
      final people = (res['people'] as List).map((x) => Person(Map<String, dynamic>.from(x as Map))).where((x) => x.hasSelfie).toList();
      if (!mounted) return;
      setState(() {
        _people = people;
        _personId ??= people.where((x) => x.isSelf).firstOrNull?.id ?? people.firstOrNull?.id;
      });
      if (_personId != null) await _feed.refresh('/api/me/photos?personId=$_personId');
    } on ApiException catch (e) {
      if (mounted) toast(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = DsColors.of(context);
    final people = _people;
    return Scaffold(
      appBar: _selected.isEmpty
          ? AppBar(title: const Text('My photos'))
          : AppBar(
              leading: IconButton(tooltip: 'Clear selection', icon: const Icon(Icons.close), onPressed: () => setState(_selected.clear)),
              title: Text('${_selected.length} selected'),
              actions: [
                IconButton(
                  tooltip: 'Save to phone',
                  icon: const Icon(Icons.download_outlined),
                  onPressed: () => saveToGallery(context, _feed.items.where((x) => _selected.contains(x.id)).toList()),
                ),
              ],
            ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: CustomScrollView(
          slivers: [
            if (people == null)
              const SliverFillRemaining(child: Center(child: CircularProgressIndicator()))
            else if (people.isEmpty)
              const SliverFillRemaining(
                hasScrollBody: false,
                child: EmptyView(
                  icon: Icons.face_outlined,
                  title: 'Add a selfie to see your photos',
                  body: 'InFrame looks for you in every event you join. Add your selfie — and your family\'s — on the People tab.',
                ),
              )
            else ...[
              SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.fromLTRB(Ds.pagePad(context), 0, Ds.pagePad(context), 8),
                  child: Text('From every event you\'re part of.', style: Theme.of(context).textTheme.bodyMedium!.copyWith(color: p.tx3)),
                ),
              ),
              if (people.length > 1)
                SliverToBoxAdapter(
                  child: SizedBox(
                    height: 52,
                    child: ListView(
                      scrollDirection: Axis.horizontal,
                      padding: EdgeInsets.symmetric(horizontal: Ds.pagePad(context)),
                      children: [
                        for (final person in people)
                          Padding(
                            padding: const EdgeInsets.only(right: 8),
                            child: DsChoiceChip(
                              selected: person.id == _personId,
                              avatar: PersonAvatar(name: person.name, url: person.selfieUrl, size: 24, cacheKey: person.selfieCacheKey),
                              label: person.isSelf ? 'You' : person.name,
                              count: person.matchCount,
                              onSelected: () {
                                setState(() {
                                  _personId = person.id;
                                  _selected.clear();
                                });
                                _feed.refresh('/api/me/photos?personId=${person.id}');
                              },
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              if (_feed.items.isEmpty && !_feed.loading)
                const SliverToBoxAdapter(
                  child: EmptyView(
                    icon: Icons.photo_library_outlined,
                    title: 'No photos yet',
                    body: "They'll appear here as soon as someone adds a photo to one of your events.",
                  ),
                )
              else
                PhotoGridSliver(
                  feed: _feed,
                  selected: _selected,
                  showEvent: true,
                  onToggle: (photo) => setState(() => _selected.contains(photo.id) ? _selected.remove(photo.id) : _selected.add(photo.id)),
                  onTap: (i) => Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => PhotoViewer(feed: _feed, initialIndex: i),
                    ),
                  ),
                ),
              if (_feed.loading)
                const SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.all(24),
                    child: Center(child: CircularProgressIndicator()),
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}
