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
      final results = await Future.wait([
        api.get<Map<String, dynamic>>('/api/events'),
        api.get<Map<String, dynamic>>('/api/invites'),
      ]);
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
    final p = Palette.of(context);
    final events = _events;
    return Scaffold(
      appBar: AppBar(
        title: const Logo(size: 20),
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
        backgroundColor: p.ink,
        foregroundColor: p.bg,
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
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 96),
          children: [
            Text('Your events', style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 4),
            Text("Trips, weddings and parties you're part of.", style: TextStyle(color: p.muted)),
            const SizedBox(height: 16),
            for (final inv in _invites) ...[
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: p.accentSoft,
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: p.accent.withValues(alpha: 0.3)),
                ),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Icon(Icons.mail_outline, color: p.accent, size: 20),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text('${inv.invitedBy ?? 'Someone'} invited you to ${inv.eventName}',
                          style: const TextStyle(fontWeight: FontWeight.w600)),
                    ),
                  ]),
                  if (inv.role == 'cohost') Padding(padding: const EdgeInsets.only(top: 4, left: 28), child: Text('as co-host', style: TextStyle(color: p.ink2))),
                  const SizedBox(height: 10),
                  Row(mainAxisAlignment: MainAxisAlignment.end, children: [
                    TextButton(onPressed: () => _respond(inv, false), child: const Text('Decline')),
                    const SizedBox(width: 6),
                    FilledButton(onPressed: () => _respond(inv, true), child: const Text('Join')),
                  ]),
                ]),
              ),
              const SizedBox(height: 12),
            ],
            if (_error != null) ErrorBox(_error),
            if (events == null && _error == null)
              const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator()))
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
              for (final e in events) ...[
                _EventCard(event: e, onTap: () => _open(e.id)),
                const SizedBox(height: 14),
              ],
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
    final p = Palette.of(context);
    final range = formatRange(event.startsOn, event.endsOn);
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          AspectRatio(
            aspectRatio: 16 / 9,
            child: Stack(fit: StackFit.expand, children: [
              event.coverUrl != null
                  ? NetImage(event.coverUrl, cacheKey: 'cover:${event.id}:${event.coverUrl!.split('?').first}')
                  : ColoredBox(color: p.surface2, child: Icon(Icons.photo_camera_outlined, size: 40, color: p.muted)),
              const DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(begin: Alignment.center, end: Alignment.bottomCenter, colors: [Colors.transparent, Colors.black54]),
                ),
              ),
              Positioned(
                left: 14,
                bottom: 12,
                child: Text((kindLabels[event.kind] ?? 'Event').toUpperCase(),
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, letterSpacing: 1.6, fontSize: 12)),
              ),
              if (event.myCount > 0)
                Positioned(
                  right: 12,
                  top: 12,
                  child: Transform.rotate(
                    angle: 0.03,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                      decoration: BoxDecoration(color: p.accent, borderRadius: BorderRadius.circular(99)),
                      child: Text("You're in ${event.myCount}", style: TextStyle(color: p.accentInk, fontWeight: FontWeight.w800, fontSize: 12)),
                    ),
                  ),
                ),
            ]),
          ),
          Padding(
            padding: const EdgeInsets.all(14),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text(event.name, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600))),
                if (event.role != 'member') Pill(roleLabels[event.role] ?? event.role),
              ]),
              const SizedBox(height: 6),
              Wrap(spacing: 14, runSpacing: 4, children: [
                if (range != null) _Meta(icon: Icons.calendar_today_outlined, text: range),
                _Meta(icon: Icons.photo_outlined, text: plural(event.photoCount, 'photo')),
                _Meta(icon: Icons.people_outline, text: '${event.memberCount}'),
              ]),
            ]),
          ),
        ]),
      ),
    );
  }
}

class _Meta extends StatelessWidget {
  const _Meta({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final p = Palette.of(context);
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Icon(icon, size: 14, color: p.muted),
      const SizedBox(width: 4),
      Text(text, style: TextStyle(color: p.muted, fontSize: 13)),
    ]);
  }
}
