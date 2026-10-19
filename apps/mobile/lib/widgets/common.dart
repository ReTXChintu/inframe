import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../api/api.dart';
import '../theme.dart';

// ─── Formatting ────────────────────────────────────────────────────────────
String plural(int n, String one, [String? many]) => '${NumberFormat.decimalPattern().format(n)} ${n == 1 ? one : (many ?? '${one}s')}';

String? formatRange(String? start, String? end) {
  DateTime? p(String? s) => s == null ? null : DateTime.tryParse(s);
  final a = p(start), b = p(end);
  if (a == null && b == null) return null;
  final full = DateFormat('d MMM yyyy');
  if (a != null && (b == null || b == a)) return full.format(a);
  if (a == null) return full.format(b!);
  if (a.year == b!.year) return '${DateFormat('d MMM').format(a)} – ${full.format(b)}';
  return '${full.format(a)} – ${full.format(b)}';
}

String prettyCode(String code) => code.replaceAllMapped(RegExp(r'(.{4})(?=.)'), (m) => '${m[1]}-');

String initials(String name) {
  final parts = name.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).take(2);
  final s = parts.map((w) => w[0].toUpperCase()).join();
  return s.isEmpty ? '?' : s;
}

String formatBytes(int? n) {
  if (n == null || n == 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  var v = n.toDouble();
  var i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return '${v.toStringAsFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}';
}

// ─── Feedback ──────────────────────────────────────────────────────────────
void toast(BuildContext context, String message, {bool error = false}) {
  final p = Palette.of(context);
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Row(children: [
        Icon(error ? Icons.error_outline : Icons.check_circle_outline, color: error ? const Color(0xFFFF8A75) : const Color(0xFF6EE0AD), size: 20),
        const SizedBox(width: 10),
        Expanded(child: Text(message, style: TextStyle(color: p.bg))),
      ]),
    ));
}

String errorText(Object e) => e is ApiException ? e.message : 'Something went wrong.';

Future<bool> confirm(BuildContext context, {required String title, String? body, String action = 'Confirm', bool danger = false}) async {
  final p = Palette.of(context);
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: body == null ? null : Text(body, style: TextStyle(color: p.muted)),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
        FilledButton(
          style: danger ? FilledButton.styleFrom(backgroundColor: p.danger, foregroundColor: Colors.white) : null,
          onPressed: () => Navigator.pop(ctx, true),
          child: Text(action),
        ),
      ],
    ),
  );
  return ok == true;
}

// ─── Inputs ────────────────────────────────────────────────────────────────

/// Password input with a show/hide eye button (labelled for screen readers).
class PasswordField extends StatefulWidget {
  const PasswordField({
    super.key,
    required this.controller,
    required this.label,
    this.error,
    this.hint,
    this.autofillHints,
    this.textInputAction,
    this.onSubmitted,
  });

  final TextEditingController controller;
  final String label;
  final String? error;
  final String? hint;
  final Iterable<String>? autofillHints;
  final TextInputAction? textInputAction;
  final ValueChanged<String>? onSubmitted;

  @override
  State<PasswordField> createState() => _PasswordFieldState();
}

class _PasswordFieldState extends State<PasswordField> {
  bool _visible = false;

  @override
  Widget build(BuildContext context) {
    final label = _visible ? 'Hide password' : 'Show password';
    return TextField(
      controller: widget.controller,
      obscureText: !_visible,
      autocorrect: false,
      enableSuggestions: false,
      autofillHints: widget.autofillHints,
      textInputAction: widget.textInputAction,
      onSubmitted: widget.onSubmitted,
      decoration: InputDecoration(
        labelText: widget.label,
        errorText: widget.error,
        helperText: widget.hint,
        helperMaxLines: 2,
        suffixIcon: IconButton(
          tooltip: label,
          icon: Icon(_visible ? Icons.visibility_off_outlined : Icons.visibility_outlined, semanticLabel: label),
          onPressed: () => setState(() => _visible = !_visible),
        ),
      ),
    );
  }
}

// ─── Visual bits ───────────────────────────────────────────────────────────
class Logo extends StatelessWidget {
  const Logo({super.key, this.size = 22});
  final double size;

  @override
  Widget build(BuildContext context) {
    final p = Palette.of(context);
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Container(
        width: size * 1.3,
        height: size * 1.3,
        decoration: BoxDecoration(color: p.ink, borderRadius: BorderRadius.circular(size * 0.33)),
        child: CustomPaint(painter: _ViewfinderPainter(p.bg, p.accent)),
      ),
      SizedBox(width: size * 0.4),
      Text.rich(
        TextSpan(children: [
          const TextSpan(text: 'In'),
          TextSpan(text: 'Frame', style: TextStyle(color: p.accent)),
        ]),
        style: Theme.of(context).textTheme.titleLarge?.copyWith(fontSize: size, fontWeight: FontWeight.w700),
      ),
    ]);
  }
}

class _ViewfinderPainter extends CustomPainter {
  _ViewfinderPainter(this.line, this.dot);
  final Color line, dot;

  @override
  void paint(Canvas canvas, Size s) {
    final u = s.width / 32;
    final paint = Paint()
      ..color = line
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.4 * u
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    for (final pts in [
      [8, 13, 8, 8, 13, 8],
      [19, 8, 24, 8, 24, 13],
      [24, 19, 24, 24, 19, 24],
      [13, 24, 8, 24, 8, 19],
    ]) {
      final path = Path()
        ..moveTo(pts[0] * u, pts[1] * u)
        ..lineTo(pts[2] * u, pts[3] * u)
        ..lineTo(pts[4] * u, pts[5] * u);
      canvas.drawPath(path, paint);
    }
    canvas.drawCircle(Offset(16 * u, 16 * u), 3.2 * u, Paint()..color = dot);
  }

  @override
  bool shouldRepaint(covariant _ViewfinderPainter old) => old.line != line || old.dot != dot;
}

/// Network image from the server. Signed URLs rotate every few hours, so the
/// cache key is the stable part (photo id + variant), not the full URL.
class NetImage extends StatelessWidget {
  const NetImage(this.url, {super.key, this.cacheKey, this.fit = BoxFit.cover});
  final String? url;
  final String? cacheKey;
  final BoxFit fit;

  @override
  Widget build(BuildContext context) {
    final p = Palette.of(context);
    if (url == null) return ColoredBox(color: p.surface2, child: Icon(Icons.image_outlined, color: p.muted));
    return CachedNetworkImage(
      imageUrl: api.resolve(url!),
      cacheKey: cacheKey ?? url!.split('?').first,
      fit: fit,
      fadeInDuration: const Duration(milliseconds: 150),
      placeholder: (_, _) => ColoredBox(color: p.surface2),
      errorWidget: (_, _, _) => ColoredBox(color: p.surface2, child: Icon(Icons.broken_image_outlined, color: p.muted)),
    );
  }
}

class PersonAvatar extends StatelessWidget {
  const PersonAvatar({super.key, required this.name, this.url, this.size = 40, this.cacheKey});
  final String name;
  final String? url;
  final double size;
  final String? cacheKey;

  @override
  Widget build(BuildContext context) {
    final p = Palette.of(context);
    return ClipOval(
      child: SizedBox.square(
        dimension: size,
        child: url != null
            ? NetImage(url, cacheKey: cacheKey)
            : ColoredBox(
                color: p.surface2,
                child: Center(
                  child: Text(initials(name), style: TextStyle(fontWeight: FontWeight.w600, color: p.ink2, fontSize: size * 0.36)),
                ),
              ),
      ),
    );
  }
}

class Pill extends StatelessWidget {
  const Pill(this.text, {super.key, this.tone = PillTone.neutral, this.icon});
  final String text;
  final PillTone tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final p = Palette.of(context);
    final (bg, fg) = switch (tone) {
      PillTone.neutral => (p.surface2, p.ink2),
      PillTone.accent => (p.accentSoft, p.accent),
      PillTone.ok => (p.okSoft, p.ok),
      PillTone.warn => (p.accentSoft, p.warn),
      PillTone.danger => (p.dangerSoft, p.danger),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(99)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (icon != null) ...[Icon(icon, size: 13, color: fg), const SizedBox(width: 4)],
        Text(text, style: TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.w600)),
      ]),
    );
  }
}

enum PillTone { neutral, accent, ok, warn, danger }

class EmptyView extends StatelessWidget {
  const EmptyView({super.key, required this.icon, required this.title, this.body, this.action});
  final IconData icon;
  final String title;
  final String? body;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final p = Palette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 48),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Container(
          width: 72,
          height: 72,
          decoration: BoxDecoration(border: Border.all(color: p.line, width: 2), borderRadius: BorderRadius.circular(18)),
          child: Icon(icon, size: 32, color: p.muted),
        ),
        const SizedBox(height: 16),
        Text(title, textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600)),
        if (body != null) ...[
          const SizedBox(height: 6),
          Text(body!, textAlign: TextAlign.center, style: TextStyle(color: p.muted)),
        ],
        if (action != null) ...[const SizedBox(height: 18), action!],
      ]),
    );
  }
}

class ErrorBox extends StatelessWidget {
  const ErrorBox(this.message, {super.key});
  final String? message;

  @override
  Widget build(BuildContext context) {
    if (message == null) return const SizedBox.shrink();
    final p = Palette.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: p.dangerSoft, borderRadius: BorderRadius.circular(12)),
      child: Text(message!, style: TextStyle(color: p.danger)),
    );
  }
}

class SectionCard extends StatelessWidget {
  const SectionCard({super.key, required this.title, this.subtitle, required this.child, this.trailing});
  final String title;
  final String? subtitle;
  final Widget child;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final p = Palette.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(title, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600))),
            ?trailing,
          ]),
          if (subtitle != null) ...[const SizedBox(height: 4), Text(subtitle!, style: TextStyle(color: p.muted, fontSize: 13))],
          const SizedBox(height: 12),
          child,
        ]),
      ),
    );
  }
}

/// Small loader button: shows a spinner while [busy].
class BusyButton extends StatelessWidget {
  const BusyButton({super.key, required this.label, required this.onPressed, this.busy = false, this.icon});
  final String label;
  final VoidCallback? onPressed;
  final bool busy;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final p = Palette.of(context);
    return FilledButton(
      onPressed: busy ? null : onPressed,
      child: busy
          ? SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2.2, color: p.bg))
          : Row(mainAxisSize: MainAxisSize.min, children: [
              if (icon != null) ...[Icon(icon, size: 18), const SizedBox(width: 8)],
              Text(label),
            ]),
    );
  }
}
