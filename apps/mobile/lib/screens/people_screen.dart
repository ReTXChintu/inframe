import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api.dart';
import '../api/models.dart';
import '../state/session.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/selfie.dart';

/// You + family members, each with the selfie InFrame searches for.
class PeopleScreen extends StatefulWidget {
  const PeopleScreen({super.key});

  @override
  State<PeopleScreen> createState() => _PeopleScreenState();
}

class _PeopleScreenState extends State<PeopleScreen> {
  List<Person>? _people;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await api.get<Map<String, dynamic>>('/api/people');
      if (mounted) setState(() => _people = (res['people'] as List).map((x) => Person(Map<String, dynamic>.from(x as Map))).toList());
    } on ApiException catch (e) {
      if (mounted) toast(context, e.message, error: true);
    }
  }

  Future<void> _selfie(Person person) async {
    if (await captureSelfie(context, person)) {
      await _load();
      if (mounted) context.read<Session>().reloadMe();
    }
  }

  Future<void> _edit([Person? person]) async {
    final name = TextEditingController(text: person?.name ?? '');
    final relation = TextEditingController(text: person?.relation ?? '');
    final save = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(person == null ? 'Add family member' : 'Edit'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: name, autofocus: true, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Name')),
          const SizedBox(height: 12),
          TextField(controller: relation, textCapitalization: TextCapitalization.sentences, decoration: const InputDecoration(labelText: 'Relation (optional)', hintText: 'Daughter, Mum…')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(person == null ? 'Next: add their photo' : 'Save')),
        ],
      ),
    );
    if (save != true || name.text.trim().isEmpty) return;
    try {
      if (person == null) {
        final res = await api.post<Map<String, dynamic>>('/api/people', {'name': name.text.trim(), 'relation': relation.text.trim()});
        await _load();
        if (mounted) await _selfie(Person(Map<String, dynamic>.from(res['person'] as Map)));
      } else {
        await api.patch<dynamic>('/api/people/${person.id}', {'name': name.text.trim(), 'relation': relation.text.trim()});
        _load();
      }
    } on ApiException catch (e) {
      if (mounted) toast(context, e.message, error: true);
    }
  }

  Future<void> _remove(Person person) async {
    if (!await confirm(context, title: 'Remove ${person.name}?', body: 'Their photo and matches are deleted. Photos themselves stay in the events.', action: 'Remove', danger: true)) return;
    try {
      await api.delete<dynamic>('/api/people/${person.id}');
      _load();
    } on ApiException catch (e) {
      if (mounted) toast(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = Palette.of(context);
    final people = _people;
    final self = people?.where((x) => x.isSelf).firstOrNull;
    final family = people?.where((x) => !x.isSelf).toList() ?? [];
    return Scaffold(
      appBar: AppBar(title: const Text('People')),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: p.ink,
        foregroundColor: p.bg,
        icon: const Icon(Icons.person_add_alt),
        label: const Text('Add family'),
        onPressed: () => _edit(),
      ),
      body: people == null
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 96),
                children: [
                  Text(
                    'InFrame finds these faces in every event you\'re part of. Selfies are only used for matching and never shown to other guests.',
                    style: TextStyle(color: p.muted),
                  ),
                  const SizedBox(height: 16),
                  if (self != null)
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Row(children: [
                          PersonAvatar(name: self.name, url: self.selfieUrl, size: 72, cacheKey: self.selfieCacheKey),
                          const SizedBox(width: 16),
                          Expanded(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text('YOU', style: TextStyle(color: p.accent, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.6)),
                              Text(self.name, style: Theme.of(context).textTheme.titleLarge),
                              const SizedBox(height: 2),
                              Text(
                                self.hasSelfie ? 'Found in ${plural(self.matchCount, 'photo')} so far.' : "No selfie yet — we can't find your photos without one.",
                                style: TextStyle(color: p.muted, fontSize: 13),
                              ),
                              const SizedBox(height: 10),
                              FilledButton.icon(
                                icon: const Icon(Icons.photo_camera_front_outlined, size: 18),
                                label: Text(self.hasSelfie ? 'Retake selfie' : 'Take a selfie'),
                                onPressed: () => _selfie(self),
                              ),
                            ]),
                          ),
                        ]),
                      ),
                    ),
                  const SizedBox(height: 22),
                  Text('Family', style: Theme.of(context).textTheme.titleLarge),
                  Text('Kids, parents, partner — find their photos too, even without an account.', style: TextStyle(color: p.muted, fontSize: 13)),
                  const SizedBox(height: 12),
                  if (family.isEmpty)
                    OutlinedButton.icon(onPressed: () => _edit(), icon: const Icon(Icons.face_outlined), label: const Text('Add a family member'))
                  else
                    for (final person in family) ...[
                      Card(
                        child: ListTile(
                          contentPadding: const EdgeInsets.fromLTRB(12, 6, 4, 6),
                          leading: PersonAvatar(name: person.name, url: person.selfieUrl, size: 48, cacheKey: person.selfieCacheKey),
                          title: Text(person.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                          subtitle: Text([
                            if (person.relation != null && person.relation!.isNotEmpty) person.relation!,
                            person.hasSelfie ? plural(person.matchCount, 'photo') : 'No photo yet — tap the camera',
                          ].join(' · ')),
                          trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                            IconButton(tooltip: 'Photo of ${person.name}', icon: const Icon(Icons.photo_camera_outlined), onPressed: () => _selfie(person)),
                            PopupMenuButton<String>(
                              tooltip: 'Options for ${person.name}',
                              onSelected: (a) => a == 'edit' ? _edit(person) : _remove(person),
                              itemBuilder: (_) => [
                                const PopupMenuItem(value: 'edit', child: Text('Edit')),
                                PopupMenuItem(value: 'remove', child: Text('Remove', style: TextStyle(color: p.danger))),
                              ],
                            ),
                          ]),
                        ),
                      ),
                      const SizedBox(height: 10),
                    ],
                ],
              ),
            ),
    );
  }
}
