import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';

import '../api/api.dart';
import '../api/models.dart';
import '../theme.dart';
import '../widgets/common.dart';

Future<void> showShareSheet(BuildContext context, EventDetail event) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _ShareSheet(event: event),
  );
}

class _ShareSheet extends StatefulWidget {
  const _ShareSheet({required this.event});
  final EventDetail event;

  @override
  State<_ShareSheet> createState() => _ShareSheetState();
}

class _ShareSheetState extends State<_ShareSheet> {
  final _emails = TextEditingController();
  String _role = 'member';
  bool _busy = false;

  List<String> get _parsed => _emails.text.split(RegExp(r'[\s,;]+')).map((e) => e.trim().toLowerCase()).where((e) => e.isNotEmpty).toList();

  Future<void> _invite() async {
    setState(() => _busy = true);
    try {
      final res = await api.post<Map<String, dynamic>>('/api/events/${widget.event.id}/invites', {'emails': _parsed, 'role': _role});
      final sent = (res['sent'] as num).toInt();
      _emails.clear();
      if (mounted) toast(context, sent > 0 ? 'Invite sent to ${plural(sent, 'person', 'people')}.' : "They're all already in the event.");
    } on ApiException catch (e) {
      if (mounted) toast(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = DsColors.of(context);
    final event = widget.event;
    final code = event.joinCode;
    final link = code == null ? null : '${api.baseUrl}/join/$code';
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 24 + MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const DsIconTile(Icons.person_add_alt),
                const SizedBox(width: 12),
                Expanded(child: Text('Invite people', style: Theme.of(context).textTheme.titleLarge)),
              ],
            ),
            const SizedBox(height: 16),
            if (code != null && link != null) ...[
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(Ds.rLg),
                      border: Border.all(color: p.ln),
                    ),
                    child: QrImageView(data: link, size: 132, backgroundColor: Colors.white),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Join code', style: Theme.of(context).textTheme.labelMedium),
                        const SizedBox(height: 4),
                        SelectableText(
                          prettyCode(code),
                          style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontFamily: Ds.mono, fontWeight: FontWeight.w500, letterSpacing: 2),
                        ),
                        const SizedBox(height: 12),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            FilledButton.icon(
                              icon: const Icon(Icons.share, size: 18),
                              label: const Text('Share'),
                              onPressed: () => SharePlus.instance.share(
                                ShareParams(
                                  subject: 'Join ${event.name} on InFrame',
                                  text: 'Join "${event.name}" on InFrame — add your photos and find the ones you\'re in.\n$link\nCode: ${prettyCode(code)}',
                                ),
                              ),
                            ),
                            OutlinedButton.icon(
                              icon: const Icon(Icons.copy, size: 18),
                              label: const Text('Copy link'),
                              onPressed: () async {
                                await Clipboard.setData(ClipboardData(text: link));
                                if (context.mounted) toast(context, 'Link copied.');
                              },
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ] else
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                decoration: BoxDecoration(color: p.sunk, borderRadius: BorderRadius.circular(Ds.rLg)),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.info_outline, size: 18, color: p.tx2),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        event.isHost
                            ? 'Joining with a code is off. Turn it on in event settings, or invite people by email below.'
                            : 'Joining with a code is off for this event. Ask a host to invite people.',
                        style: Theme.of(context).textTheme.bodySmall!.copyWith(color: p.tx2),
                      ),
                    ),
                  ],
                ),
              ),
            if (event.isHost) ...[
              const Divider(height: 40),
              Text('Invite by email', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 2),
              Text(
                'They get a link to join. If they\'re new, they create an account first.',
                style: Theme.of(context).textTheme.bodySmall!.copyWith(color: p.tx3),
              ),
              const SizedBox(height: 12),
              DsTextField(
                controller: _emails,
                label: 'Email addresses',
                minLines: 2,
                maxLines: 4,
                autocorrect: false,
                keyboardType: TextInputType.emailAddress,
                onChanged: (_) => setState(() {}),
                hint: 'priya@example.com, rahul@example.com',
              ),
              if (event.isOwner) ...[
                const SizedBox(height: 16),
                DsLabel(
                  'Invite as',
                  child: DsSegmented<String>(
                    label: 'Invite as',
                    value: _role,
                    options: const [('member', 'Guest', null), ('cohost', 'Co-host', null)],
                    onChanged: (v) => setState(() => _role = v),
                  ),
                ),
              ],
              const SizedBox(height: 16),
              BusyButton(
                label: _parsed.length > 1 ? 'Send ${_parsed.length} invites' : 'Send invite',
                icon: Icons.send,
                busy: _busy,
                onPressed: _parsed.isEmpty ? null : _invite,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
