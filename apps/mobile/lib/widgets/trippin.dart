import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/models.dart';
import '../theme.dart';
import 'common.dart';

/// "Planned in Trippin" (opens the trip) while the event is linked to a
/// Trippin trip; "Was linked to Trippin" after the trip stopped sharing.
/// An accent badge (§7.4) with a trailing arrow when it's a link.
class TrippinChip extends StatelessWidget {
  const TrippinChip(this.link, {super.key});
  final ExternalLink link;

  @override
  Widget build(BuildContext context) {
    if (!link.linked) return const DsBadge('Was linked to Trippin', icon: Icons.link_off, tone: DsTone.outline);
    final url = link.url;
    if (url == null) return const DsBadge('Planned in Trippin', tone: DsTone.accent, icon: Icons.luggage_outlined);
    final p = DsColors.of(context);
    return Semantics(
      button: true,
      link: true,
      child: Material(
        color: p.acSoft,
        borderRadius: BorderRadius.circular(Ds.rSm),
        child: InkWell(
          borderRadius: BorderRadius.circular(Ds.rSm),
          onTap: () async {
            var opened = false;
            try {
              opened = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
            } catch (_) {
              // not a launchable link
            }
            if (!opened && context.mounted) toast(context, "Couldn't open Trippin.", error: true);
          },
          child: Container(
            constraints: const BoxConstraints(minHeight: 28),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.luggage_outlined, size: 14, color: p.ac),
                const SizedBox(width: 6),
                Text(
                  'Planned in Trippin',
                  style: TextStyle(fontFamily: Ds.sans, color: p.ac, fontSize: 12, height: 16 / 12, fontWeight: FontWeight.w600),
                ),
                const SizedBox(width: 4),
                Icon(Icons.north_east, size: 14, color: p.ac),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The event has no storage folder yet. The owner gets the way to connect
/// one; everyone else learns why there are no photos. An info callout (§7.5).
class StoragePendingBanner extends StatelessWidget {
  const StoragePendingBanner({super.key, required this.isOwner, this.onConnect});
  final bool isOwner;
  final VoidCallback? onConnect;

  @override
  Widget build(BuildContext context) {
    return DsCallout(
      icon: Icons.create_new_folder_outlined,
      tone: isOwner ? DsTone.warn : DsTone.accent,
      title: isOwner ? 'Connect a folder to start adding photos' : 'No photos yet',
      body: isOwner
          ? "Pick a Google Drive or MEGA folder for this event's photos. Everyone can add photos once it's connected."
          : 'Photos will appear once the owner connects a folder.',
      action: isOwner && onConnect != null
          ? FilledButton.icon(
              style: FilledButton.styleFrom(minimumSize: const Size(0, 40), padding: const EdgeInsets.symmetric(horizontal: 16)),
              icon: const Icon(Icons.folder_open_outlined, size: 18),
              label: const Text('Connect a folder'),
              onPressed: onConnect,
            )
          : null,
    );
  }
}
