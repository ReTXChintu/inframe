import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:background_downloader/background_downloader.dart';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

import '../api/api.dart';

/// Where one file is on its way into an event.
enum UploadStage { queued, uploading, received, storing, processing, findingFaces, done, failed }

/// One file the user picked, from "waiting" to "faces matched".
class UploadEntry {
  UploadEntry({
    required this.taskId,
    required this.eventId,
    required this.name,
    required this.size,
    required this.isVideo,
    required this.assetId,
    required this.uri,
    required this.mimeType,
    required this.modifiedAt,
    this.folderId,
    this.stage = UploadStage.queued,
    this.progress = 0,
    this.photoId,
    this.faces,
    this.matches = 0,
    this.error,
  });

  String taskId;
  final String eventId;
  final String name;
  final int size;
  final bool isVideo;

  /// Gallery id (photo_manager) — used for the row thumbnail.
  final String assetId;

  /// `content://` URI the background uploader reads the file from.
  final String uri;
  final String mimeType;
  final int modifiedAt;
  final String? folderId;
  UploadStage stage;
  double progress;
  String? photoId;
  int? faces;
  int matches;
  String? error;

  bool get active => stage == UploadStage.queued || stage == UploadStage.uploading;
  bool get onServer =>
      photoId != null &&
      const {UploadStage.received, UploadStage.storing, UploadStage.processing, UploadStage.findingFaces}.contains(stage);
  bool get finished => stage == UploadStage.done || stage == UploadStage.failed;

  Map<String, dynamic> toJson() => {
    'taskId': taskId,
    'eventId': eventId,
    'name': name,
    'size': size,
    'isVideo': isVideo,
    'assetId': assetId,
    'uri': uri,
    'mimeType': mimeType,
    'modifiedAt': modifiedAt,
    'folderId': folderId,
    'stage': stage.name,
    'photoId': photoId,
    'faces': faces,
    'matches': matches,
    'error': error,
  };

  static UploadEntry fromJson(Map<String, dynamic> j) => UploadEntry(
    taskId: j['taskId'] as String,
    eventId: j['eventId'] as String,
    name: j['name'] as String,
    size: (j['size'] as num).toInt(),
    isVideo: j['isVideo'] == true,
    assetId: j['assetId'] as String,
    uri: j['uri'] as String,
    mimeType: j['mimeType'] as String? ?? 'application/octet-stream',
    modifiedAt: (j['modifiedAt'] as num?)?.toInt() ?? 0,
    folderId: j['folderId'] as String?,
    stage: UploadStage.values.asNameMap()[j['stage']] ?? UploadStage.queued,
    photoId: j['photoId'] as String?,
    faces: (j['faces'] as num?)?.toInt(),
    matches: (j['matches'] as num?)?.toInt() ?? 0,
    error: j['error'] as String?,
  );
}

/// A file about to be queued (from the in-app gallery).
class PickedMedia {
  PickedMedia({
    required this.assetId,
    required this.uri,
    required this.name,
    required this.size,
    required this.isVideo,
    required this.mimeType,
    required this.modifiedAt,
  });
  final String assetId;
  final String uri;
  final String name;
  final int size;
  final bool isVideo;
  final String mimeType;
  final int modifiedAt;

  /// "Same file" fingerprint for duplicate checks: name + size + last-modified.
  String get key => '${name.toLowerCase()}|$size|$modifiedAt';
}

/// The app-wide upload queue.
///
/// Every file is a native background upload (WorkManager, run as a foreground
/// service with a progress notification), so it carries on when the app is in
/// the background or closed. The request uses an upload ticket instead of the
/// short-lived access token. Once the server has the bytes, its workers store
/// the file in Drive/MEGA, make previews and match faces; that part is
/// followed here by polling while the app is open.
class Uploads extends ChangeNotifier {
  Uploads._();
  static final Uploads instance = Uploads._();

  static const group = 'inframe-uploads';
  static const _maxConcurrent = 3;

  final List<UploadEntry> _entries = [];
  final _tickets = <String, (String, DateTime)>{};
  bool _started = false;
  Timer? _poll;
  Timer? _saveTimer;
  File? _store;

  List<UploadEntry> forEvent(String eventId) => _entries.where((e) => e.eventId == eventId).toList();
  bool get busy => _entries.any((e) => e.active);

  Future<void> init() async {
    if (_started) return;
    _started = true;
    final downloader = FileDownloader();
    await downloader.configure(
      androidConfig: [(Config.runInForeground, Config.always), (Config.holdingQueue, (_maxConcurrent, null, null))],
    );
    downloader.configureNotificationForGroup(
      group,
      running: const TaskNotification('Uploading to InFrame', '{numFinished} of {numTotal} done'),
      complete: const TaskNotification('Uploads finished', '{numTotal} files sent to InFrame'),
      error: const TaskNotification('Some uploads failed', '{numFailed} of {numTotal} failed — open InFrame to retry'),
      progressBar: true,
      groupNotificationId: 'inframe-uploads',
    );
    downloader.updates.listen(_onUpdate);
    await _load();
    await downloader.start(autoCleanDatabase: true);
    _ensurePolling();
  }

  // ─── Queueing ──────────────────────────────────────────────────────────

  /// Which of these files already exist in the event (or are queued here)?
  Future<Set<String>> findDuplicates(String eventId, List<PickedMedia> files) async {
    final dupes = <String>{};
    final queuedHere = {
      for (final e in _entries)
        if (e.eventId == eventId && e.stage != UploadStage.failed) '${e.name.toLowerCase()}|${e.size}|${e.modifiedAt}',
    };
    for (final f in files) {
      if (queuedHere.contains(f.key)) dupes.add(f.key);
    }
    for (var i = 0; i < files.length; i += 2000) {
      final chunk = files.sublist(i, (i + 2000).clamp(0, files.length));
      final res = await api.post<Map<String, dynamic>>('/api/events/$eventId/uploads/check', {
        'files': [
          for (final f in chunk) {'key': f.key, 'name': f.name, 'size': f.size, 'modifiedAt': f.modifiedAt},
        ],
      });
      dupes.addAll((res['duplicates'] as List).map((e) => '$e'));
    }
    return dupes;
  }

  Future<void> add(String eventId, List<PickedMedia> files, {String? folderId}) async {
    final ticket = await _ticket(eventId);
    final seen = <String>{};
    final fresh = <UploadEntry>[];
    for (final f in files) {
      if (!seen.add(f.key)) continue;
      fresh.add(
        UploadEntry(
          taskId: _newTaskId(),
          eventId: eventId,
          name: f.name,
          size: f.size,
          isVideo: f.isVideo,
          assetId: f.assetId,
          uri: f.uri,
          mimeType: f.mimeType,
          modifiedAt: f.modifiedAt,
          folderId: folderId,
        ),
      );
    }
    _entries.addAll(fresh);
    notifyListeners();
    _save();
    final ok = await FileDownloader().enqueueAll(fresh.map((e) => _task(e, ticket)));
    for (final (i, queued) in ok.indexed) {
      if (!queued) _fail(fresh[i], "Couldn't start this upload.");
    }
    notifyListeners();
    _save();
  }

  Future<void> retry(UploadEntry e) async {
    if (e.photoId != null) {
      try {
        // It reached the server; ask the server to redo its part.
        await api.post<dynamic>('/api/photos/${e.photoId}/retry');
        e
          ..stage = UploadStage.processing
          ..error = null;
        notifyListeners();
        _save();
        _ensurePolling();
        return;
      } on ApiException catch (err) {
        if (err.status != 400) rethrow;
        e.photoId = null; // the server's copy is gone: send the file again
      }
    }
    final ticket = await _ticket(e.eventId);
    e
      ..taskId = _newTaskId()
      ..stage = UploadStage.queued
      ..progress = 0
      ..error = null;
    notifyListeners();
    _save();
    if (!await FileDownloader().enqueue(_task(e, ticket))) _fail(e, "Couldn't start this upload.");
  }

  Future<void> cancelWaiting(String eventId) async {
    final waiting = _entries.where((e) => e.eventId == eventId && e.active).toList();
    await FileDownloader().cancelTasksWithIds(waiting.map((e) => e.taskId));
    _entries.removeWhere(waiting.contains);
    notifyListeners();
    _save();
  }

  void clearFinished(String eventId) {
    _entries.removeWhere((e) => e.eventId == eventId && e.finished);
    notifyListeners();
    _save();
  }

  /// Signed out: stop everything and forget it (the tickets belong to that account).
  Future<void> reset() async {
    await FileDownloader().cancelAll(group: group);
    _entries.clear();
    _tickets.clear();
    notifyListeners();
    _save();
  }

  UploadTask _task(UploadEntry e, String ticket) => UriUploadTask(
    taskId: e.taskId,
    url: '${api.baseUrl}/api/events/${e.eventId}/photos',
    urlQueryParameters: {'modifiedAt': '${e.modifiedAt}', if (e.folderId != null) 'folderId': e.folderId!},
    fileUri: Uri.parse(e.uri),
    filename: e.name,
    mimeType: e.mimeType,
    fileField: 'file',
    headers: {'x-upload-ticket': ticket, 'x-inframe-client': 'mobile'},
    group: group,
    updates: Updates.statusAndProgress,
    retries: 3,
    displayName: e.name,
  );

  Future<String> _ticket(String eventId) async {
    final cached = _tickets[eventId];
    // Tickets last 24 hours; take a new one well before that.
    if (cached != null && DateTime.now().difference(cached.$2) < const Duration(hours: 12)) return cached.$1;
    final res = await api.post<Map<String, dynamic>>('/api/events/$eventId/upload-ticket');
    final ticket = res['ticket'] as String;
    _tickets[eventId] = (ticket, DateTime.now());
    return ticket;
  }

  static int _seq = 0;
  static String _newTaskId() => 'up-${DateTime.now().microsecondsSinceEpoch}-${_seq++}';

  // ─── Native updates ───────────────────────────────────────────────────

  void _onUpdate(TaskUpdate update) {
    if (update.task.group != group) return;
    final e = _entries.where((x) => x.taskId == update.task.taskId).firstOrNull;
    if (e == null) return;
    switch (update) {
      case TaskProgressUpdate(:final progress):
        if (progress >= 0 && progress <= 1 && e.active) {
          e
            ..stage = UploadStage.uploading
            ..progress = progress;
        }
      case TaskStatusUpdate(:final status):
        switch (status) {
          case TaskStatus.running:
            e.stage = UploadStage.uploading;
          case TaskStatus.enqueued || TaskStatus.waitingToRetry:
            if (e.active) e.stage = UploadStage.queued;
          case TaskStatus.complete:
            _received(e, update.responseBody);
          case TaskStatus.failed || TaskStatus.notFound:
            _fail(e, _errorFrom(update));
          case TaskStatus.canceled:
            _fail(e, 'Cancelled.');
          case TaskStatus.paused:
            break;
        }
    }
    notifyListeners();
    _save();
  }

  void _received(UploadEntry e, String? body) {
    try {
      final json = jsonDecode(body ?? '') as Map<String, dynamic>;
      e
        ..photoId = (json['photo'] as Map)['id'] as String
        ..stage = UploadStage.received
        ..progress = 1
        ..error = null;
      _ensurePolling();
    } catch (_) {
      _fail(e, 'Unexpected answer from the server.');
    }
  }

  String _errorFrom(TaskStatusUpdate u) {
    final body = u.responseBody;
    if (body != null && body.isNotEmpty) {
      try {
        final msg = (jsonDecode(body) as Map)['message'];
        if (msg is String && msg.isNotEmpty) return msg;
      } catch (_) {
        /* not JSON */
      }
    }
    if (u.responseStatusCode == 401 || u.responseStatusCode == 403) return 'Upload pass expired — tap retry.';
    if (u.exception is TaskConnectionException) return "Couldn't reach the server.";
    if (u.exception is TaskFileSystemException) return 'This file is no longer on the phone.';
    return u.exception?.description ?? 'Upload failed.';
  }

  void _fail(UploadEntry e, String message) {
    e
      ..stage = UploadStage.failed
      ..error = message;
  }

  // ─── Server-side progress ─────────────────────────────────────────────

  void _ensurePolling() {
    _poll ??= Timer.periodic(const Duration(seconds: 4), (_) => _check());
  }

  Future<void> _check() async {
    final tracking = _entries.where((e) => e.onServer).toList();
    if (tracking.isEmpty) {
      if (!busy) {
        _poll?.cancel();
        _poll = null;
      }
      return;
    }
    try {
      final res = await api.post<Map<String, dynamic>>('/api/photos/status', {
        'photoIds': [for (final e in tracking.take(500)) e.photoId],
      });
      for (final s in (res['photos'] as List).cast<Map>()) {
        final e = tracking.where((x) => x.photoId == s['id']).firstOrNull;
        if (e != null) _apply(e, s);
      }
      notifyListeners();
      _save();
    } on ApiException {
      // next tick
    }
  }

  void _apply(UploadEntry e, Map s) {
    final status = s['status'], face = s['faceStatus'], stage = s['stage'];
    if (status == 'failed') {
      _fail(e, '${s['error'] ?? 'Processing failed.'}');
    } else if (face == 'done') {
      e
        ..stage = UploadStage.done
        ..faces = (s['faceCount'] as num?)?.toInt()
        ..matches = (s['matchCount'] as num?)?.toInt() ?? 0
        ..error = null;
    } else if (face == 'failed') {
      e
        ..stage = UploadStage.done
        ..error = 'Saved · face scan failed';
    } else if (face == 'skipped' && status == 'ready') {
      e
        ..stage = UploadStage.done
        ..error = null;
    } else if (stage == 'storing') {
      e.stage = UploadStage.storing;
    } else if (stage == 'processing') {
      e.stage = UploadStage.processing;
    } else if (status == 'ready' || face == 'processing') {
      e.stage = UploadStage.findingFaces;
    }
  }

  // ─── Persistence (so the list survives the app being closed) ──────────

  Future<File> _file() async => _store ??= File('${(await getApplicationSupportDirectory()).path}/uploads.json');

  Future<void> _load() async {
    try {
      final f = await _file();
      if (!await f.exists()) return;
      final list = jsonDecode(await f.readAsString()) as List;
      _entries.addAll(list.map((j) => UploadEntry.fromJson(Map<String, dynamic>.from(j as Map))));
      // Anything that was mid-upload is picked up again by the native queue
      // (start() replays updates that happened while the app was closed).
      notifyListeners();
    } catch (err) {
      debugPrint('uploads: could not restore the queue: $err');
    }
  }

  void _save() {
    _saveTimer?.cancel();
    _saveTimer = Timer(const Duration(milliseconds: 600), () async {
      // Keep the file small: only the newest 3000 rows.
      final keep = _entries.length > 3000 ? _entries.sublist(_entries.length - 3000) : _entries;
      try {
        await (await _file()).writeAsString(jsonEncode([for (final e in keep) e.toJson()]));
      } catch (err) {
        debugPrint('uploads: could not save the queue: $err');
      }
    });
  }
}

final uploads = Uploads.instance;
