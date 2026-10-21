import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../api/api.dart';
import '../api/models.dart';
import '../theme.dart';
import 'common.dart';

/// Take (or pick) one clear photo of a person and enrol it. The server checks
/// there's exactly one face, then matches every photo they're in.
/// Returns true when the selfie was saved.
Future<bool> captureSelfie(BuildContext context, Person person) async {
  final source = await showModalBottomSheet<ImageSource>(
    context: context,
    showDragHandle: true,
    builder: (ctx) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const DsIconTile(Icons.face_retouching_natural),
                    const SizedBox(width: 12),
                    Expanded(child: Text(person.isSelf ? 'Your selfie' : 'Photo of ${person.name}', style: Theme.of(ctx).textTheme.titleLarge)),
                  ],
                ),
                const SizedBox(height: 12),
                Text(
                  "Face the camera in good light — no sunglasses or mask, and only ${person.isSelf ? 'you' : person.name} in the shot. "
                  "It's used only to find ${person.isSelf ? 'your' : 'their'} photos.",
                  style: Theme.of(ctx).textTheme.bodyLarge!.copyWith(color: DsColors.of(ctx).tx2),
                ),
              ],
            ),
          ),
          ListTile(
            contentPadding: const EdgeInsets.symmetric(horizontal: 16),
            minTileHeight: 56,
            leading: const Icon(Icons.photo_camera_front_outlined),
            title: const Text('Take a photo'),
            onTap: () => Navigator.pop(ctx, ImageSource.camera),
          ),
          ListTile(
            contentPadding: const EdgeInsets.symmetric(horizontal: 16),
            minTileHeight: 56,
            leading: const Icon(Icons.photo_outlined),
            title: const Text('Choose from gallery'),
            onTap: () => Navigator.pop(ctx, ImageSource.gallery),
          ),
          const SizedBox(height: 8),
        ],
      ),
    ),
  );
  if (source == null || !context.mounted) return false;

  final file = await ImagePicker().pickImage(source: source, preferredCameraDevice: CameraDevice.front, maxWidth: 1600, maxHeight: 1600, imageQuality: 90);
  if (file == null || !context.mounted) return false;

  final messenger = ScaffoldMessenger.of(context);
  messenger.showSnackBar(
    SnackBar(
      duration: const Duration(minutes: 1),
      content: Row(
        children: [
          SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2, color: DsColors.of(context).bg)),
          const SizedBox(width: 12),
          Text('Finding ${person.isSelf ? 'you' : person.name} in photos…'),
        ],
      ),
    ),
  );
  try {
    final res = await api.upload<Map<String, dynamic>>(
      '/api/people/${person.id}/selfie',
      () => FormData.fromMap({'file': MultipartFile.fromFileSync(file.path, filename: 'selfie.jpg')}),
    );
    messenger.hideCurrentSnackBar();
    final n = (res['matchCount'] as num?)?.toInt() ?? 0;
    if (context.mounted) {
      toast(
        context,
        n > 0
            ? "${person.isSelf ? "You're" : '${person.name} is'} in ${plural(n, 'photo')} so far."
            : "Saved. We'll find ${person.isSelf ? 'you' : person.name} as photos come in.",
      );
    }
    return true;
  } on ApiException catch (e) {
    messenger.hideCurrentSnackBar();
    if (context.mounted) toast(context, e.message, error: true);
    return false;
  }
}
