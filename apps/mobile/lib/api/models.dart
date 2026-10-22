// Plain data classes for the API's JSON. Field names mirror the web app's types.

String? _s(dynamic v) => v is String ? v : null;
int _i(dynamic v) => v is num ? v.toInt() : 0;
int? _in(dynamic v) => v is num ? v.toInt() : null;
bool _b(dynamic v) => v == true;
DateTime? _d(dynamic v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;
Map<String, dynamic> _m(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};
List<Map<String, dynamic>> _l(dynamic v) => v is List ? v.map(_m).toList() : <Map<String, dynamic>>[];

class User {
  User(this.j);
  final Map<String, dynamic> j;
  String get id => j['id'] as String;
  String get email => _s(j['email']) ?? '';
  String get name => _s(j['name']) ?? '';
  bool get isAdmin => _b(j['isAdmin']);
}

class Person {
  Person(this.j);
  final Map<String, dynamic> j;
  String get id => j['id'] as String;
  bool get isSelf => j['kind'] == 'self';
  String get name => _s(j['name']) ?? '';
  String? get relation => _s(j['relation']);
  bool get hasSelfie => _b(j['hasSelfie']);
  String? get selfieUrl => _s(j['selfieUrl']);
  int get matchCount => _i(j['matchCount']);
  int get eventCount => _i(j['eventCount']);
  /// Stable image-cache key: changes only when a new selfie is enrolled.
  String get selfieCacheKey => 'selfie:$id:${j['enrolledAt']}';
}

class Me {
  Me(this.j);
  final Map<String, dynamic> j;
  User get user => User(_m(j['user']));
  Person? get self => j['self'] is Map ? Person(_m(j['self'])) : null;
  int get pendingInvites => _i(j['pendingInvites']);
}

/// Where an event is planned, when another app of the suite created it
/// (today: a Trippin trip). `linked` turns false once the trip stops sharing
/// photos here; the event and its photos stay.
class ExternalLink {
  ExternalLink(this.j);
  final Map<String, dynamic> j;
  String get source => _s(j['source']) ?? '';
  String? get url => _s(j['url']);
  bool get linked => _b(j['linked']);
  bool get isTrippin => source == 'trippin';

  static ExternalLink? from(dynamic v) => v is Map ? ExternalLink(_m(v)) : null;
}

const kindLabels = {'trip': 'Trip', 'wedding': 'Wedding', 'party': 'Party', 'other': 'Event'};
const roleLabels = {'owner': 'Owner', 'cohost': 'Co-host', 'member': 'Guest'};

class EventSummary {
  EventSummary(this.j);
  final Map<String, dynamic> j;
  String get id => j['id'] as String;
  String get name => _s(j['name']) ?? '';
  String get kind => _s(j['kind']) ?? 'other';
  String? get startsOn => _s(j['startsOn']);
  String? get endsOn => _s(j['endsOn']);
  String get role => _s(j['role']) ?? 'member';
  int get photoCount => _i(j['photoCount']);
  int get memberCount => _i(j['memberCount']);
  int get myCount => _i(j['myCount']);
  String? get coverUrl => _s(j['coverUrl']);
  ExternalLink? get external => ExternalLink.from(j['external']);
  /// No storage folder picked yet (events created from Trippin start like this).
  bool get storagePending => _b(j['storagePending']);
}

class Folder {
  Folder(this.j);
  final Map<String, dynamic> j;
  String get id => j['id'] as String;
  String get name => _s(j['name']) ?? '';
  int get count => _i(j['count']);
}

class EventDetail {
  EventDetail(this.j);
  final Map<String, dynamic> j;
  String get id => j['id'] as String;
  String get name => _s(j['name']) ?? '';
  String get kind => _s(j['kind']) ?? 'other';
  String? get startsOn => _s(j['startsOn']);
  String? get endsOn => _s(j['endsOn']);
  String get role => _s(j['role']) ?? 'member';
  bool get isHost => _b(j['isHost']);
  bool get isOwner => _b(j['isOwner']);
  String get ownerName => _s(_m(j['owner'])['name']) ?? '';
  bool get canViewAll => _b(_m(j['can'])['viewAll']);
  bool get canUpload => _b(_m(j['can'])['upload']);
  bool get canFaceSearch => _b(_m(j['can'])['faceSearch']);
  Map<String, dynamic> get settings => _m(j['settings']);
  /// What each guest may add in all; null = no limit (and on older servers, which had none).
  int? get guestMaxItems => _in(settings['guestMaxItems']);
  int? get guestMaxBytes => _in(settings['guestMaxBytes']);
  /// This viewer's share of the per-guest allowance; null for hosts, who have no cap.
  GuestAllowance? get guestAllowance => j['guestAllowance'] is Map ? GuestAllowance(_m(j['guestAllowance'])) : null;
  String? get joinCode => _s(j['joinCode']);
  String? get coverUrl => _s(j['coverUrl']);
  Map<String, dynamic> get storage => _m(j['storage']);
  bool get storageConnected => _b(storage['connected']);
  /// No storage folder picked yet: uploads wait until the owner connects one.
  bool get storagePending => _b(storage['pending']);
  ExternalLink? get external => ExternalLink.from(j['external']);
  String? get storageProvider => _s(storage['provider']);
  String? get storageFolderName => _s(storage['folderName']);
  String get syncState => _s(storage['syncState']) ?? 'idle';
  Map<String, dynamic> get counts => _m(j['counts']);
  int? count(String key) => _in(counts[key]);
  List<Folder> get folders => _l(j['folders']).map(Folder.new).toList();
  List<Person> get people => _l(j['people']).map(Person.new).toList();
  Person? get self => people.where((p) => p.isSelf).firstOrNull;
}

/// How much of an event's per-guest allowance a guest has left. A null
/// maximum means that side isn't limited.
class GuestAllowance {
  GuestAllowance(this.j);
  final Map<String, dynamic> j;
  int? get maxItems => _in(j['maxItems']);
  int? get maxBytes => _in(j['maxBytes']);
  int get usedItems => _i(j['usedItems']);
  int get usedBytes => _i(j['usedBytes']);
  bool get limited => maxItems != null || maxBytes != null;
  /// Files still allowed; null when the count isn't limited.
  int? get itemsLeft => maxItems == null ? null : (maxItems! - usedItems).clamp(0, maxItems!);
  /// Bytes still allowed; null when the size isn't limited.
  int? get bytesLeft => maxBytes == null ? null : (maxBytes! - usedBytes).clamp(0, maxBytes!);
  bool get exhausted => itemsLeft == 0 || bytesLeft == 0;
}

class Photo {
  Photo(this.j);
  final Map<String, dynamic> j;
  String get id => j['id'] as String;
  String get eventId => _s(j['eventId']) ?? '';
  String? get eventName => _s(j['eventName']);
  String? get uploaderId => _s(j['uploaderId']);
  String get originalName => _s(j['originalName']) ?? 'photo.jpg';
  bool get isVideo => j['mediaType'] == 'video';
  int? get durationMs => _in(j['durationMs']);
  int? get width => _in(j['width']);
  int? get height => _in(j['height']);
  int? get sizeBytes => _in(j['sizeBytes']);
  DateTime? get takenAt => _d(j['takenAt']);
  String get faceStatus => _s(j['faceStatus']) ?? 'pending';
  int get faceCount => _i(j['faceCount']);
  bool get favorite => _b(j['favorite']);
  List<Map<String, dynamic>> get people => _l(j['people']);
  bool get hasMe => people.any((p) => p['kind'] == 'self');
  String? get thumbUrl => _s(j['thumbUrl']);
  String? get previewUrl => _s(j['previewUrl']);
  String? get originalUrl => _s(j['originalUrl']);
  // Detail-only fields
  String? get uploaderName => _s(j['uploaderName']);
  String? get folderName => _s(j['folderName']);
  bool get canDelete => _b(j['canDelete']);

  Photo copyWith(Map<String, dynamic> patch) => Photo({...j, ...patch});
}

class PhotoPage {
  PhotoPage(Map<String, dynamic> j)
      : items = _l(j['items']).map(Photo.new).toList(),
        nextCursor = _s(j['nextCursor']);
  final List<Photo> items;
  final String? nextCursor;
}

class Member {
  Member(this.j);
  final Map<String, dynamic> j;
  String get userId => j['userId'] as String;
  String get name => _s(j['name']) ?? '';
  String? get email => _s(j['email']);
  String get role => _s(j['role']) ?? 'member';
  bool get isYou => _b(j['isYou']);
}

class MyInvite {
  MyInvite(this.j);
  final Map<String, dynamic> j;
  String get id => j['id'] as String;
  String get eventName => _s(j['eventName']) ?? '';
  String get eventKind => _s(j['eventKind']) ?? 'other';
  String? get invitedBy => _s(j['invitedBy']);
  String get role => _s(j['role']) ?? 'member';
}

class EventPreview {
  EventPreview(this.j);
  final Map<String, dynamic> j;
  String get id => j['id'] as String;
  String get name => _s(j['name']) ?? '';
  String get kind => _s(j['kind']) ?? 'other';
  String? get startsOn => _s(j['startsOn']);
  String? get endsOn => _s(j['endsOn']);
  String get ownerName => _s(j['ownerName']) ?? '';
  int get memberCount => _i(j['memberCount']);
}

class Connection {
  Connection(this.j);
  final Map<String, dynamic> j;
  String get id => j['id'] as String;
  String get provider => _s(j['provider']) ?? '';
  String get accountLabel => _s(j['accountLabel']) ?? '';
  bool get broken => j['status'] == 'error';
  String? get lastError => _s(j['lastError']);
  int get eventCount => _i(j['eventCount']);
  String get providerLabel => const {'gdrive': 'Google Drive', 'mega': 'MEGA', 'memory': 'Dev memory storage'}[provider] ?? provider;
}
