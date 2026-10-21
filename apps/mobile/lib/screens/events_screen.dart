import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api.dart';
import '../api/models.dart';
import '../state/session.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'event_screen.dart';
import 'join_screen.dart';
import 'new_event_screen.dart';

class EventsScreen extends StatefulWidget {
  const EventsScreen({super.key});

  @override
  State<EventsScreen> createState() => _EventsScreenState();
}

class _EventsScreenState extends State<EventsScreen> {
  List<EventSummary>? _events;
  List<MyInvite> _invites = [];
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([api.get<Map<String, dynamic>>('/api/events'), api.get<Map<String, dynamic>>('/api/invites')]);
      if (!mounted) return;
      setState(() {
        _events = (results[0]['events'] as List).map((e) => EventSummary(Map<String, dynamic>.from(e as Map))).toList();
        _invites = (results[1]['invites'] as List).map((e) => MyInvite(Map<String, dynamic>.from(e as Map))).toList();
        _error = null;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _open(String eventId) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => EventScreen(eventId: eventId)));
    _load();
  }

  Future<void> _respond(MyInvite invite, bool accept) async {
    try {
      if (accept) {
        final res = await api.post<Map<String, dynamic>>('/api/invites/${invite.id}/accept');
        if (!mounted) return;
        context.read<Session>().reloadMe();
        await _open(res['eventId'] as String);
      } else {
        await api.post<dynamic>('/api/invites/${invite.id}/decline');
        if (mounted) context.read<Session>().reloadMe();
        _load();
      }
    } on ApiException catch (e) {
      if (mounted) toast(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = DsColors.of(context);
    final events = _events;
    return Scaffold(
      appBar: AppBar(
        title: const Logo(),
        actions: [
          IconButton(
            tooltip: 'Join with a code',
            icon: const Icon(Icons.qr_code_scanner),
            onPressed: () async {
              final id = await Navigator.push<String>(context, MaterialPageRoute(builder: (_) => const JoinScreen()));
              if (id != null) await _open(id);
              _load();
            },
          ),
          const SizedBox(width: 4),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        icon: const Icon(Icons.add),
        label: const Text('New event'),
        onPressed: () async {
          final id = await Navigator.push<String>(context, MaterialPageRoute(builder: (_) => const NewEventScreen()));
          if (id != null) await _open(id);
          _load();
        },
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: EdgeInsets.fromLTRB(Ds.pagePad(context), 8, Ds.pagePad(context), 96),
          children: [
            Text('Your events', style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 4),
            Text("Trips, weddings and parties you're part of.", style: Theme.of(context).textTheme.bodyMedium!.copyWith(color: p.tx3)),
            const SizedBox(height: 16),
            for (final inv in _invites) ...[
              DsCallout(
                icon: Icons.mail_outline,
                title: '${inv.invitedBy ?? 'Someone'} invited you to ${inv.eventName}',
                body: inv.role == 'cohost' ? 'as co-host' : null,
                action: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    TextButton(onPressed: () => _respond(inv, false), child: const Text('Decline')),
                    const SizedBox(width: 8),
                    FilledButton(onPressed: () => _respond(inv, true), child: const Text('Join')),
                  ],
                ),
              ),
              const SizedBox(height: 12),
            ],
            if (_error != null) ErrorBox(_error),
            if (events == null && _error == null)
              const Padding(
                padding: EdgeInsets.all(48),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (events != null && events.isEmpty)
              EmptyView(
                icon: Icons.photo_camera_outlined,
                title: 'No events yet',
                body: 'Create one for your next trip and invite everyone — or join a friend\'s event with their code.',
                action: OutlinedButton.icon(
                  icon: const Icon(Icons.qr_code_scanner),
                  label: const Text('I have a code'),
                  onPressed: () async {
                    final id = await Navigator.push<String>(context, MaterialPageRoute(builder: (_) => const JoinScreen()));
                    if (id != null) await _open(id);
                    _load();
                  },
                ),
              )
            else if (events != null)
              // Full width: one column on phones, more as the screen widens.
              LayoutBuilder(
                builder: (context, box) {
                  final cols = box.maxWidth >= 1000
                      ? 3
                      : box.maxWidth >= 600
                      ? 2
                      : 1;
                  const gap = 16.0;
                  final w = (box.maxWidth - gap * (cols - 1)) / cols;
                  return Wrap(
                    spacing: gap,
                    runSpacing: gap,
                    children: [
                      for (final e in events)
                        SizedBox(
                          width: w,
                          child: _EventCard(event: e, onTap: () => _open(e.id)),
                        ),
                    ],
                  );
                },
              ),
          ],
        ),
      ),
    );
  }
}

class _EventCard extends StatelessWidget {
  const _EventCard({required this.event, required this.onTap});
  final EventSummary event;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = DsColors.of(context);
    final range = formatRange(event.startsOn, event.endsOn);
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AspectRatio(
              aspectRatio: 16 / 9,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  event.coverUrl != null
                      ? NetImage(event.coverUrl, cacheKey: 'cover:${event.id}:${event.coverUrl!.split('?').first}')
                      : ColoredBox(
                          color: p.sunk,
                          child: Icon(Icons.photo_camera_outlined, size: 40, color: p.tx3),
                        ),
                  // The photo is the hero: only a quiet accent badge sits on it.
                  if (event.myCount > 0)
                    Positioned(
                      right: 12,
                      top: 12,
                      child: Container(
                        height: 24,
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        alignment: Alignment.center,
                        decoration: BoxDecoration(color: p.ac, borderRadius: BorderRadius.circular(Ds.rSm)),
                        child: Text(
                          "You're in ${event.myCount}",
                          style: TextStyle(color: p.acTx, fontWeight: FontWeight.w600, fontSize: 12, fontFeatures: Ds.tabular),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(kindLabels[event.kind] ?? 'Event', style: Theme.of(context).textTheme.labelMedium),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Expanded(child: Text(event.name, style: Theme.of(context).textTheme.titleSmall)),
                      if (event.role != 'member') ...[const SizedBox(width: 8), DsBadge(roleLabels[event.role] ?? event.role)],
                    ],
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 14,
                    runSpacing: 4,
                    children: [
                      if (range != null) _Meta(icon: Icons.calendar_today_outlined, text: range),
                      _Meta(icon: Icons.photo_outlined, text: plural(event.photoCount, 'photo')),
                      _Meta(icon: Icons.people_outline, text: '${event.memberCount}'),
                      if (event.external case final link? when link.isTrippin && link.linked) const _Meta(icon: Icons.luggage_outlined, text: 'Trippin'),
                      if (event.storagePending && event.role == 'owner') _Meta(icon: Icons.create_new_folder_outlined, text: 'Connect a folder', color: p.warn),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Meta extends StatelessWidget {
  const _Meta({required this.icon, required this.text, this.color});
  final IconData icon;
  final String text;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final c = color ?? DsColors.of(context).tx3;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: c),
        const SizedBox(width: 4),
        Text(
          text,
          style: TextStyle(color: c, fontSize: 13, height: 18 / 13, fontFeatures: Ds.tabular),
        ),
      ],
    );
  }
}
