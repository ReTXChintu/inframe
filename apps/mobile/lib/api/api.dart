import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../config.dart';

/// An error the server explained (or a network failure), ready to show.
class ApiException implements Exception {
  ApiException(this.status, this.code, this.message, [this.fields = const {}]);

  final int status;
  final String code;
  final String message;
  final Map<String, String> fields;

  @override
  String toString() => message;
}

/// Thin client for the InFrame API.
///
/// The access token lives in memory; the refresh token in the platform's
/// secure storage. Any 401 triggers one refresh-and-retry. The server sees
/// `x-inframe-client: mobile` and hands the refresh token back in the body
/// (browsers keep it in a cookie instead).
class Api {
  Api._();
  static final Api instance = Api._();

  static const _storage = FlutterSecureStorage();
  static const _refreshKey = 'inframe.refresh';
  static const _serverKey = 'inframe.server';

  String baseUrl = defaultServerUrl;
  String? _accessToken;
  Future<bool>? _refreshing;

  /// Called when the session can't be refreshed any more (signed out elsewhere, password changed…).
  void Function()? onSignedOut;

  late final Dio _dio = Dio(
    BaseOptions(
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 60),
      headers: {'x-inframe-client': 'mobile'},
      validateStatus: (_) => true,
    ),
  );

  Future<void> load() async {
    baseUrl = normalizeServerUrl(await _storage.read(key: _serverKey) ?? defaultServerUrl);
  }

  Future<void> setServer(String url) async {
    baseUrl = normalizeServerUrl(url);
    await _storage.write(key: _serverKey, value: baseUrl);
  }

  /// Absolute URL for a server-relative path like `/media/p/…`.
  String resolve(String path) => path.startsWith('http') ? path : '$baseUrl$path';

  Future<bool> get hasSession async => (await _storage.read(key: _refreshKey)) != null;

  Future<void> _saveTokens(Map<String, dynamic> body) async {
    _accessToken = body['accessToken'] as String?;
    final refresh = body['refreshToken'] as String?;
    if (refresh != null) await _storage.write(key: _refreshKey, value: refresh);
  }

  Future<void> clearSession() async {
    _accessToken = null;
    await _storage.delete(key: _refreshKey);
  }

  /// Swap the stored refresh token for a fresh pair. Concurrent callers share one attempt.
  Future<bool> refresh() {
    return _refreshing ??= () async {
      try {
        final token = await _storage.read(key: _refreshKey);
        if (token == null) return false;
        final res = await _dio.post<dynamic>(
          '$baseUrl/api/auth/refresh',
          options: Options(headers: {'x-refresh-token': token}),
        );
        if (res.statusCode == 200 && res.data is Map) {
          await _saveTokens(Map<String, dynamic>.from(res.data as Map));
          return true;
        }
        if (res.statusCode == 401) await clearSession();
        return false;
      } on DioException {
        return false; // offline: keep the refresh token for next time
      } finally {
        _refreshing = null;
      }
    }();
  }

  /// Use tokens from a sign-in style response (login, signup, password change).
  Future<void> adopt(Map<String, dynamic> body) => _saveTokens(body);

  Future<T> get<T>(String path, {Map<String, dynamic>? query}) => _send<T>('GET', path, query: query);
  Future<T> post<T>(String path, [Object? body]) => _send<T>('POST', path, data: body ?? const {});
  Future<T> patch<T>(String path, Object body) => _send<T>('PATCH', path, data: body);
  Future<T> put<T>(String path, Object body) => _send<T>('PUT', path, data: body);
  Future<T> delete<T>(String path, [Object? body]) => _send<T>('DELETE', path, data: body);

  Future<T> upload<T>(
    String path,
    FormData Function() form, {
    void Function(double fraction)? onProgress,
    CancelToken? cancel,
  }) =>
      _send<T>('POST', path, form: form, onProgress: onProgress, cancel: cancel);

  Future<T> _send<T>(
    String method,
    String path, {
    Object? data,
    Map<String, dynamic>? query,
    FormData Function()? form,
    void Function(double)? onProgress,
    CancelToken? cancel,
  }) async {
    Future<Response<dynamic>> attempt() => _dio.request<dynamic>(
          '$baseUrl$path',
          data: form != null ? form() : data,
          queryParameters: query,
          cancelToken: cancel,
          onSendProgress: onProgress == null ? null : (sent, total) => total > 0 ? onProgress(sent / total) : null,
          options: Options(
            method: method,
            headers: {if (_accessToken != null) 'Authorization': 'Bearer $_accessToken'},
          ),
        );

    Response<dynamic> res;
    try {
      res = await attempt();
      if (res.statusCode == 401 && !path.startsWith('/api/auth/')) {
        if (await refresh()) {
          res = await attempt();
        } else if (!await hasSession) {
          // Only when the server rejected the refresh token, not when we're just offline.
          onSignedOut?.call();
        }
      }
    } on DioException catch (e) {
      if (e.type == DioExceptionType.cancel) throw ApiException(0, 'cancelled', 'Cancelled.');
      throw ApiException(0, 'network', "Can't reach the InFrame server. Check your connection.");
    }

    final status = res.statusCode ?? 0;
    if (status >= 200 && status < 300) return res.data as T;
    final body = res.data is Map ? Map<String, dynamic>.from(res.data as Map) : <String, dynamic>{};
    final fields = <String, String>{};
    final rawFields = (body['details'] is Map) ? (body['details'] as Map)['fields'] : null;
    if (rawFields is Map) {
      rawFields.forEach((k, v) => fields['$k'] = '$v');
    }
    throw ApiException(
      status,
      (body['code'] as String?) ?? 'error',
      (body['message'] as String?) ?? (status >= 500 ? 'Something went wrong on the server.' : 'Request failed ($status).'),
      fields,
    );
  }

  /// Raw bytes of a URL on the server (originals for "save to phone").
  Future<List<int>> bytes(String url) async {
    final res = await _dio.get<List<int>>(resolve(url), options: Options(responseType: ResponseType.bytes));
    if ((res.statusCode ?? 0) >= 400 || res.data == null) {
      throw ApiException(res.statusCode ?? 0, 'download', 'Download failed.');
    }
    return res.data!;
  }

  /// Stream a URL on the server into a local file (videos for "save to phone").
  Future<void> downloadTo(String url, String path) async {
    final res = await _dio.download(resolve(url), path, options: Options(receiveTimeout: const Duration(minutes: 30)));
    if ((res.statusCode ?? 0) >= 400) throw ApiException(res.statusCode ?? 0, 'download', 'Download failed.');
  }

  /// Plain GET for public files (app-version.json); null when missing.
  Future<Map<String, dynamic>?> publicJson(String path) async {
    try {
      final res = await _dio.get<dynamic>('$baseUrl$path', options: Options(responseType: ResponseType.json));
      if (res.statusCode == 200 && res.data is Map) return Map<String, dynamic>.from(res.data as Map);
    } on DioException {
      // ignore
    }
    return null;
  }
}

final api = Api.instance;
