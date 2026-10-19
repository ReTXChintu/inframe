import 'package:flutter/material.dart';

import '../api/api.dart';
import '../api/models.dart';
import '../theme.dart';
import 'common.dart';

Future<List<Connection>> loadConnections() async {
  final res = await api.get<Map<String, dynamic>>('/api/storage/connections');
  return (res['connections'] as List).map((c) => Connection(Map<String, dynamic>.from(c as Map))).toList();
}

IconData providerIcon(String provider) => switch (provider) {
      'gdrive' => Icons.add_to_drive,
      'mega' => Icons.cloud_outlined,
      _ => Icons.memory,
    };

/// Bottom sheet: sign in to MEGA. Returns the new connection.
Future<Connection?> connectMega(BuildContext context) {
  return showModalBottomSheet<Connection>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => const _MegaSheet(),
  );
}

class _MegaSheet extends StatefulWidget {
  const _MegaSheet();

  @override
  State<_MegaSheet> createState() => _MegaSheetState();
}

class _MegaSheetState extends State<_MegaSheet> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;
  Map<String, String> _fields = {};

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
      _fields = {};
    });
    try {
      final res = await api.post<Map<String, dynamic>>('/api/storage/mega', {'email': _email.text.trim(), 'password': _password.text});
      if (mounted) Navigator.pop(context, Connection(Map<String, dynamic>.from(res['connection'] as Map)));
    } on ApiException catch (e) {
      setState(() => e.fields.isNotEmpty ? _fields = e.fields : _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = Palette.of(context);
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('Connect MEGA', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 6),
        Text(
          'InFrame signs in to your MEGA account to save and read event photos. Your password is stored encrypted. '
          "Accounts with two-factor login aren't supported.",
          style: TextStyle(color: p.muted, fontSize: 13),
        ),
        const SizedBox(height: 16),
        ErrorBox(_error),
        if (_error != null) const SizedBox(height: 12),
        TextField(
          controller: _email,
          keyboardType: TextInputType.emailAddress,
          decoration: InputDecoration(labelText: 'MEGA email', errorText: _fields['email']),
        ),
        const SizedBox(height: 12),
        PasswordField(controller: _password, label: 'MEGA password', error: _fields['password'], onSubmitted: (_) => _submit()),
        const SizedBox(height: 18),
        BusyButton(label: 'Connect MEGA', busy: _busy, onPressed: _submit),
      ]),
    );
  }
}
