import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api.dart';
import '../api/models.dart';
import '../state/session.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'share_sheet.dart';

/// Event details, privacy switches (hosts), people and leave/delete.
/// Pops with `true` when the user left or deleted the event.
class EventSettingsScreen extends StatefulWidget {
  const EventSettingsScreen({super.key, required this.eventId});
  final String eventId;

  @override
  State<EventSettingsScreen> createState() => _EventSettingsScreenState();
}

class _EventSettingsScreenState extends State<EventSettingsScreen> {
  EventDetail? _event;
  List<Member> _members = [];
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        api.get<Map<String, dynamic>>('/api/events/${widget.eventId}'),
        api.get<Map<String, dynamic>>('/api/events/${widget.eventId}/members'),
      ]);
      if (!mounted) return;
      setState(() {
        _event = EventDetail(Map<String, dynamic>.from(results[0]['event'] as Map));
        _members = (results[1]['members'] as List).map((m) => Member(Map<String, dynamic>.from(m as Map))).toList();
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _patch(Map<String, dynamic> body) async {
    try {
      final res = await api.patch<Map<String, dynamic>>('/api/events/${widget.eventId}', body);
      if (mounted) setState(() => _event = EventDetail(Map<String, dynamic>.from(res['event'] as Map)));
    } on ApiException catch (e) {
      if (mounted) toast(context, e.message, error: true);
    }
  }

  Future<void> _rename() async {
    final controller = TextEditingController(text: _event!.name);
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Rename event'),
        content: DsTextField(controller: controller, autofocus: true, maxLength: 100, label: 'Name'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, controller.text.trim()), child: const Text('Save')),
        ],
      ),
    );
    if (name != null && name.isNotEmpty) _patch({'name': name});
  }

  Future<void> _memberAction(Member m, String action) async {
    try {
      if (action == 'remove') {
        if (!await confirm(
          context,
          title: 'Remove ${m.name}?',
          body: 'They lose access to this event. Photos they added stay.',
          action: 'Remove',
          danger: true,
        )) {
          return;
        }
        await api.delete<dynamic>('/api/events/${widget.eventId}/members/${m.userId}');
      } else {
        await api.patch<dynamic>('/api/events/${widget.eventId}/members/${m.userId}', {'role': action});
      }
      _load();
    } on ApiException catch (e) {
      if (mounted) toast(context, e.message, error: true);
    }
  }

  Future<void> _leaveOrDelete() async {
    final event = _event!;
    final me = context.read<Session>().me?.user.id;
    try {
      if (event.isOwner) {
        if (!await confirm(
          context,
          title: 'Delete “${event.name}”?',
          body: "This removes the event, its albums and face matches for everyone. Files in your Drive/MEGA folder aren't touched.",
          action: 'Delete event',
          danger: true,
        )) {
          return;
        }
        await api.delete<dynamic>('/api/events/${event.id}');
      } else {
        if (!await confirm(context, title: 'Leave “${event.name}”?', action: 'Leave', danger: true)) return;
        await api.delete<dynamic>('/api/events/${event.id}/members/$me');
      }
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) toast(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = DsColors.of(context);
    final event = _event;
    if (event == null) {
      return Scaffold(
        appBar: AppBar(),
        body: Center(child: _error != null ? Text(_error!) : const CircularProgressIndicator()),
      );
    }
    final s = event.settings;
    return Scaffold(
      appBar: AppBar(title: Text(event.isHost ? 'Event settings' : 'Event details')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: EdgeInsets.fromLTRB(Ds.pagePad(context), 4, Ds.pagePad(context), 32),
          children: [
            SectionCard(
              title: event.name,
              trailing: event.isHost ? IconButton(tooltip: 'Rename', icon: const Icon(Icons.edit_outlined), onPressed: _rename) : null,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _Line('Kind', kindLabels[event.kind] ?? 'Event'),
                  _Line('Dates', formatRange(event.startsOn, event.endsOn) ?? '—'),
                  _Line('Hosted by', event.ownerName),
                  _Line('Your role', roleLabels[event.role] ?? event.role),
                  if (event.external case final link? when link.isTrippin) _Line('Trip', link.linked ? 'Planned in Trippin' : 'Was linked to Trippin'),
                  if (event.storagePending)
                    _Line('Storage', event.isOwner ? 'No folder yet. Connect one from the event page.' : 'No folder yet')
                  else if (event.storageProvider != null)
                    _Line(
                      'Storage',
                      '${event.storageFolderName ?? 'Folder'} · ${const {'gdrive': 'Google Drive', 'mega': 'MEGA', 'memory': 'Dev memory'}[event.storageProvider] ?? ''}',
                    ),
                ],
              ),
            ),
            if (event.isHost) ...[
              const SizedBox(height: 16),
              SectionCard(
                title: 'Sharing & privacy',
                subtitle: 'Hosts always see everything. These apply to guests.',
                child: Column(
                  children: [
                    _Switch(
                      'Anyone with the code can join',
                      'Off: only people you invite by email.',
                      s['joinEnabled'] == true,
                      (v) => _patch({'joinEnabled': v}),
                    ),
                    _Switch('Guests can add photos', 'Off: only you and co-hosts can upload.', s['guestUploads'] == true, (v) => _patch({'guestUploads': v})),
                    _Switch(
                      'Guests see all photos',
                      "Off: guests see only photos they're in, their uploads and favourites.",
                      s['guestsSeeAll'] == true,
                      (v) => !v && s['faceSearch'] != true
                          ? toast(context, 'Turn on face search first, or guests would see nothing.', error: true)
                          : _patch({'guestsSeeAll': v}),
                    ),
                    _Switch(
                      'Face search',
                      'Guests can find the photos they and their family are in.',
                      s['faceSearch'] == true,
                      (v) => !v && s['guestsSeeAll'] != true
                          ? toast(context, 'Let guests see all photos first, or they\'d see nothing.', error: true)
                          : _patch({'faceSearch': v}),
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 16),
            SectionCard(
              title: 'People · ${_members.length}',
              trailing: TextButton.icon(
                icon: const Icon(Icons.person_add_alt, size: 18),
                label: const Text('Invite'),
                onPressed: () => showShareSheet(context, event),
              ),
              child: Column(
                children: [
                  for (final m in _members)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: PersonAvatar(name: m.name),
                      title: Text(m.isYou ? '${m.name} (you)' : m.name),
                      subtitle: m.email == null ? null : Text(m.email!, overflow: TextOverflow.ellipsis),
                      trailing: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          DsBadge(roleLabels[m.role] ?? m.role, tone: m.role == 'owner' ? DsTone.accent : DsTone.neutral),
                          if (!m.isYou && m.role != 'owner' && event.isHost && (m.role == 'member' || event.isOwner))
                            PopupMenuButton<String>(
                              tooltip: 'Options for ${m.name}',
                              onSelected: (a) => _memberAction(m, a),
                              itemBuilder: (_) => [
                                if (event.isOwner && m.role == 'member') const PopupMenuItem(value: 'cohost', child: Text('Make co-host')),
                                if (event.isOwner && m.role == 'cohost') const PopupMenuItem(value: 'member', child: Text('Make guest')),
                                PopupMenuItem(
                                  value: 'remove',
                                  child: Text('Remove', style: TextStyle(color: p.crit)),
                                ),
                              ],
                            ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              style: dsDangerOutline(context),
              icon: Icon(event.isOwner ? Icons.delete_outline : Icons.logout),
              label: Text(event.isOwner ? 'Delete event' : 'Leave event'),
              onPressed: _leaveOrDelete,
            ),
            if (event.isHost)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(
                  'Storage, albums and photo re-scans are managed on the website.',
                  style: TextStyle(color: p.tx3, fontSize: 12),
                  textAlign: TextAlign.center,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _Line extends StatelessWidget {
  const _Line(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 4),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 96,
          child: Text(
            label,
            style: Theme.of(context).textTheme.bodySmall!.copyWith(color: DsColors.of(context).tx3, height: 20 / 13),
          ),
        ),
        Expanded(
          child: Text(value, style: Theme.of(context).textTheme.bodyMedium!.copyWith(fontFeatures: Ds.tabular)),
        ),
      ],
    ),
  );
}

class _Switch extends StatelessWidget {
  const _Switch(this.title, this.subtitle, this.value, this.onChanged);
  final String title;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) => SwitchListTile(
    contentPadding: EdgeInsets.zero,
    minTileHeight: 48,
    title: Text(title, style: Theme.of(context).textTheme.bodyMedium!.copyWith(color: DsColors.of(context).tx)),
    subtitle: Text(
      subtitle,
      style: TextStyle(color: DsColors.of(context).tx3, fontSize: 12, height: 16 / 12),
    ),
    value: value,
    onChanged: onChanged,
  );
}
