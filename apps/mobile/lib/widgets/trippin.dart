import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/models.dart';
import '../theme.dart';
import 'common.dart';

/// "Planned in Trippin" (opens the trip) while the event is linked to a
/// Trippin trip; "Was linked to Trippin" after the trip stopped sharing.
class TrippinChip extends StatelessWidget {
  const TrippinChip(this.link, {super.key});
  final ExternalLink link;

  @override
  Widget build(BuildContext context) {
    if (!link.linked) return const Pill('Was linked to Trippin', icon: Icons.link_off);
    const pill = Pill('Planned in Trippin', tone: PillTone.accent, icon: Icons.luggage_outlined);
    final url = link.url;
    if (url == null) return pill;
    return Semantics(
      button: true,
      link: true,
      child: InkWell(
        borderRadius: BorderRadius.circular(99),
        onTap: () async {
          var opened = false;
          try {
            opened = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
          } catch (_) {
            // not a launchable link
          }
          if (!opened && context.mounted) toast(context, "Couldn't open Trippin.", error: true);
        },
        child: pill,
      ),
    );
  }
}

/// The event has no storage folder yet. The owner gets the way to connect
/// one; everyone else learns why there are no photos.
class StoragePendingBanner extends StatelessWidget {
  const StoragePendingBanner({super.key, required this.isOwner, this.onConnect});
  final bool isOwner;
  final VoidCallback? onConnect;

  @override
  Widget build(BuildContext context) {
    final p = Palette.of(context);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: p.accentSoft,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: p.accent.withValues(alpha: 0.3)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(Icons.create_new_folder_outlined, color: p.accent, size: 28),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(
                isOwner ? 'Connect a folder to start adding photos' : 'No photos yet',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 2),
              Text(
                isOwner
                    ? "Pick a Google Drive or MEGA folder for this event's photos. Everyone can add photos once it's connected."
                    : 'Photos will appear once the owner connects a folder.',
                style: TextStyle(color: p.ink2, fontSize: 13),
              ),
            ]),
          ),
        ]),
        if (isOwner && onConnect != null) ...[
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: p.accent, foregroundColor: p.accentInk, minimumSize: const Size(0, 40)),
              icon: const Icon(Icons.folder_open_outlined, size: 18),
              label: const Text('Connect a folder'),
              onPressed: onConnect,
            ),
          ),
        ],
      ]),
    );
  }
}
