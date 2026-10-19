import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../api/api.dart';
import '../api/models.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// The code inside anything a QR or a paste might give us: a bare code, a
/// formatted XXXX-XXXX code, or a full `…/join/CODE` link.
String? extractJoinCode(String raw) {
  final fromLink = RegExp(r'/join/([A-Za-z0-9-]+)').firstMatch(raw)?.group(1);
  final cleaned = (fromLink ?? raw).toUpperCase().replaceAll(RegExp(r'[^A-Z0-9]'), '');
  return cleaned.length == 8 ? cleaned : null;
}

/// Enter / scan a join code → preview → join. Pops with the event id.
class JoinScreen extends StatefulWidget {
  const JoinScreen({super.key});

  @override
  State<JoinScreen> createState() => _JoinScreenState();
}

class _JoinScreenState extends State<JoinScreen> {
  final _code = TextEditingController();
  bool _busy = false;
  String? _error;
  EventPreview? _preview;
  bool _isMember = false;

  Future<void> _lookup([String? raw]) async {
    final code = extractJoinCode(raw ?? _code.text);
    if (code == null) {
      setState(() => _error = 'Enter the 8-character code, like ABCD-2345.');
      return;
    }
    _code.text = prettyCode(code);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final res = await api.get<Map<String, dynamic>>('/api/join/$code');
      setState(() {
        _preview = EventPreview(Map<String, dynamic>.from(res['event'] as Map));
        _isMember = res['isMember'] == true;
      });
    } on ApiException catch (e) {
      setState(() => _error = e.status == 404 ? "That code doesn't work. It may be mistyped, or the host made a new one." : e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _join() async {
    final code = extractJoinCode(_code.text)!;
    setState(() => _busy = true);
    try {
      final res = await api.post<Map<String, dynamic>>('/api/join/$code');
      if (!mounted) return;
      final matched = (res['matched'] as num?)?.toInt() ?? 0;
      if (matched > 0) toast(context, "Welcome! You're already in ${plural(matched, 'photo')}.");
      Navigator.pop(context, res['eventId'] as String);
    } on ApiException catch (e) {
      if (mounted) toast(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _scan() async {
    final raw = await Navigator.push<String>(context, MaterialPageRoute(builder: (_) => const _ScannerScreen()));
    if (raw != null) _lookup(raw);
  }

  @override
  Widget build(BuildContext context) {
    final p = Palette.of(context);
    final preview = _preview;
    return Scaffold(
      appBar: AppBar(title: const Text('Join an event')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          Text('Enter the code from the host, or scan their QR code.', style: TextStyle(color: p.muted, fontSize: 15)),
          const SizedBox(height: 18),
          TextField(
            controller: _code,
            textCapitalization: TextCapitalization.characters,
            autocorrect: false,
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(letterSpacing: 4),
            inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9-]')), LengthLimitingTextInputFormatter(9)],
            decoration: InputDecoration(labelText: 'Join code', hintText: 'ABCD-2345', errorText: _error),
            onChanged: (_) => setState(() => _preview = null),
            onSubmitted: (_) => _lookup(),
          ),
          const SizedBox(height: 14),
          Row(children: [
            Expanded(child: BusyButton(label: 'Continue', busy: _busy && preview == null, onPressed: () => _lookup())),
            const SizedBox(width: 10),
            OutlinedButton.icon(onPressed: _scan, icon: const Icon(Icons.qr_code_scanner), label: const Text('Scan QR')),
          ]),
          if (preview != null) ...[
            const SizedBox(height: 24),
            Card(
              clipBehavior: Clip.antiAlias,
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Container(
                  color: p.ink,
                  padding: const EdgeInsets.fromLTRB(18, 28, 18, 20),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text((kindLabels[preview.kind] ?? 'Event').toUpperCase(),
                        style: TextStyle(color: p.accent, fontWeight: FontWeight.w700, letterSpacing: 2, fontSize: 12)),
                    const SizedBox(height: 6),
                    Text(preview.name, style: Theme.of(context).textTheme.headlineSmall?.copyWith(color: p.bg)),
                    const SizedBox(height: 4),
                    Text('Hosted by ${preview.ownerName}', style: TextStyle(color: p.bg.withValues(alpha: 0.7))),
                  ]),
                ),
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Text(
                      [formatRange(preview.startsOn, preview.endsOn), plural(preview.memberCount, 'member')].whereType<String>().join(' · '),
                      style: TextStyle(color: p.muted),
                    ),
                    const SizedBox(height: 14),
                    _isMember
                        ? FilledButton(onPressed: () => Navigator.pop(context, preview.id), child: const Text("You're in — open the event"))
                        : BusyButton(label: 'Join ${(kindLabels[preview.kind] ?? 'event').toLowerCase()}', busy: _busy, onPressed: _join),
                  ]),
                ),
              ]),
            ),
          ],
        ],
      ),
    );
  }
}

class _ScannerScreen extends StatefulWidget {
  const _ScannerScreen();

  @override
  State<_ScannerScreen> createState() => _ScannerScreenState();
}

class _ScannerScreenState extends State<_ScannerScreen> {
  bool _done = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white, title: const Text('Scan the event QR')),
      body: Stack(children: [
        MobileScanner(
          onDetect: (capture) {
            if (_done) return;
            for (final b in capture.barcodes) {
              final raw = b.rawValue;
              if (raw != null && extractJoinCode(raw) != null) {
                _done = true;
                Navigator.pop(context, raw);
                return;
              }
            }
          },
        ),
        Center(
          child: Container(
            width: 240,
            height: 240,
            decoration: BoxDecoration(border: Border.all(color: Colors.white70, width: 2), borderRadius: BorderRadius.circular(18)),
          ),
        ),
        const Positioned(
          left: 0,
          right: 0,
          bottom: 48,
          child: Text('Point the camera at the QR code from the host', textAlign: TextAlign.center, style: TextStyle(color: Colors.white)),
        ),
      ]),
    );
  }
}
