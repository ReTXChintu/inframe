import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api.dart';

/// The server publishes `/app-version.json` next to `/inframe.apk` on every
/// release. If its build number is newer than ours, offer the download.
Future<void> checkForAppUpdate(BuildContext context, {bool tellIfCurrent = false}) async {
  final latest = await api.publicJson('/app-version.json');
  final info = await PackageInfo.fromPlatform();
  if (!context.mounted) return;
  final latestBuild = int.tryParse('${latest?['build'] ?? ''}') ?? 0;
  final currentBuild = int.tryParse(info.buildNumber) ?? 0;
  if (latest == null || latestBuild <= currentBuild) {
    if (tellIfCurrent) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text("You're on the latest version (${info.version}).")));
    }
    return;
  }
  final url = api.resolve('${latest['url'] ?? '/inframe.apk'}');
  ScaffoldMessenger.of(context).showMaterialBanner(
    MaterialBanner(
      leading: const Icon(Icons.system_update),
      content: Text('InFrame ${latest['version'] ?? ''} is available.'),
      actions: [
        TextButton(
          onPressed: () => ScaffoldMessenger.of(context).hideCurrentMaterialBanner(),
          child: const Text('Later'),
        ),
        FilledButton(
          onPressed: () {
            ScaffoldMessenger.of(context).hideCurrentMaterialBanner();
            launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
          },
          child: const Text('Update'),
        ),
      ],
    ),
  );
}
