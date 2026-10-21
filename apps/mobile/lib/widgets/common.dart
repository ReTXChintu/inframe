import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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

/// 0:42, 3:07, 1:02:15
String formatDuration(Duration d) {
  final h = d.inHours, m = d.inMinutes % 60, s = (d.inSeconds % 60).toString().padLeft(2, '0');
  return h > 0 ? '$h:${m.toString().padLeft(2, '0')}:$s' : '$m:$s';
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

/// Inverse toast (§7.12): ink fill, paper text, a 20 px leading icon.
void toast(BuildContext context, String message, {bool error = false}) {
  final p = DsColors.of(context);
  // The toast is drawn in the opposite theme, so borrow that theme's semantic colours.
  final inverse = Theme.of(context).brightness == Brightness.dark ? DsColors.light : DsColors.dark;
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        duration: const Duration(seconds: 6),
        content: Row(
          children: [
            Icon(error ? Icons.error_outline : Icons.check_circle_outline, color: error ? inverse.crit : inverse.good, size: 20),
            const SizedBox(width: 12),
            Expanded(
              child: Text(message, style: TextStyle(color: p.bg)),
            ),
          ],
        ),
      ),
    );
}

String errorText(Object e) => e is ApiException ? e.message : 'Something went wrong.';

/// Dialog (§7.7): radius 20, ghost Cancel + primary (or destructive) action.
Future<bool> confirm(BuildContext context, {required String title, String? body, String action = 'Confirm', bool danger = false}) async {
  final p = DsColors.of(context);
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: body == null ? null : Text(body),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
        FilledButton(
          style: danger ? FilledButton.styleFrom(backgroundColor: p.critFill, foregroundColor: Colors.white) : null,
          onPressed: () => Navigator.pop(ctx, true),
          child: Text(action),
        ),
      ],
    ),
  );
  return ok == true;
}

// ─── Inputs ────────────────────────────────────────────────────────────────

/// Field label (§7.2): 12/16 600 tx2 +.02em, 6 above the field.
class DsLabel extends StatelessWidget {
  const DsLabel(this.text, {super.key, required this.child});
  final String text;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(text, style: Theme.of(context).textTheme.labelMedium),
        const SizedBox(height: 6),
        child,
      ],
    );
  }
}

/// A 52 px text field with its label above it (§7.2).
class DsTextField extends StatelessWidget {
  const DsTextField({
    super.key,
    required this.controller,
    this.label,
    this.hint,
    this.helper,
    this.error,
    this.keyboardType,
    this.textCapitalization = TextCapitalization.none,
    this.autofocus = false,
    this.autocorrect = true,
    this.enableSuggestions = true,
    this.maxLength,
    this.minLines,
    this.maxLines = 1,
    this.style,
    this.inputFormatters,
    this.onChanged,
    this.onSubmitted,
    this.textInputAction,
  });

  final TextEditingController controller;
  final String? label;
  final String? hint;
  final String? helper;
  final String? error;
  final TextInputType? keyboardType;
  final TextCapitalization textCapitalization;
  final bool autofocus;
  final bool autocorrect;
  final bool enableSuggestions;
  final int? maxLength;
  final int? minLines;
  final int? maxLines;
  final TextStyle? style;
  final List<TextInputFormatter>? inputFormatters;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final TextInputAction? textInputAction;

  @override
  Widget build(BuildContext context) {
    final field = TextField(
      controller: controller,
      keyboardType: keyboardType,
      textCapitalization: textCapitalization,
      autofocus: autofocus,
      autocorrect: autocorrect,
      enableSuggestions: enableSuggestions,
      maxLength: maxLength,
      minLines: minLines,
      maxLines: maxLines,
      style: style ?? Theme.of(context).textTheme.bodyLarge,
      inputFormatters: inputFormatters,
      onChanged: onChanged,
      onSubmitted: onSubmitted,
      textInputAction: textInputAction,
      decoration: InputDecoration(hintText: hint, helperText: helper, helperMaxLines: 3, errorText: error, errorMaxLines: 3),
    );
    return label == null ? field : DsLabel(label!, child: field);
  }
}

/// Password / secret input with a show/hide eye button (§7.2), labelled for
/// screen readers ("Show password" / "Hide password"). Revealed values switch
/// to IBM Plex Mono so ambiguous characters are clear.
class DsPasswordField extends StatefulWidget {
  const DsPasswordField({
    super.key,
    required this.controller,
    required this.label,
    this.noun = 'password',
    this.error,
    this.hint,
    this.autofillHints,
    this.textInputAction,
    this.onSubmitted,
  });

  final TextEditingController controller;
  final String label;

  /// What the field holds, for the button's label: "Show password", "Show key", "Show PIN".
  final String noun;
  final String? error;
  final String? hint;
  final Iterable<String>? autofillHints;
  final TextInputAction? textInputAction;
  final ValueChanged<String>? onSubmitted;

  @override
  State<DsPasswordField> createState() => _DsPasswordFieldState();
}

class _DsPasswordFieldState extends State<DsPasswordField> {
  bool _visible = false;

  @override
  Widget build(BuildContext context) {
    final label = '${_visible ? 'Hide' : 'Show'} ${widget.noun}';
    final base = Theme.of(context).textTheme.bodyLarge!;
    return DsLabel(
      widget.label,
      child: TextField(
        controller: widget.controller,
        obscureText: !_visible,
        autocorrect: false,
        enableSuggestions: false,
        autofillHints: widget.autofillHints,
        textInputAction: widget.textInputAction,
        onSubmitted: widget.onSubmitted,
        style: _visible ? base.copyWith(fontFamily: Ds.mono) : base,
        decoration: InputDecoration(
          errorText: widget.error,
          helperText: widget.hint,
          helperMaxLines: 2,
          suffixIcon: Semantics(
            label: label,
            toggled: _visible,
            button: true,
            excludeSemantics: true,
            child: IconButton(
              tooltip: label,
              icon: Icon(_visible ? Icons.visibility_off_outlined : Icons.visibility_outlined, size: 20, semanticLabel: label),
              onPressed: () => setState(() => _visible = !_visible),
            ),
          ),
        ),
      ),
    );
  }
}

/// Segmented control (§7.3): sunk track radius 12, padding 4, an sf thumb
/// with a small shadow that slides to the selected option.
class DsSegmented<T> extends StatelessWidget {
  const DsSegmented({super.key, required this.value, required this.options, required this.onChanged, this.label});
  final T value;
  final List<(T, String, IconData?)> options;
  final ValueChanged<T> onChanged;
  final String? label;

  @override
  Widget build(BuildContext context) {
    final p = DsColors.of(context);
    final text = Theme.of(context).textTheme;
    final index = options.indexWhere((o) => o.$1 == value).clamp(0, options.length - 1);
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Semantics(
      label: label,
      container: true,
      child: Container(
        height: 44,
        padding: const EdgeInsets.all(4),
        decoration: BoxDecoration(color: p.sunk, borderRadius: BorderRadius.circular(Ds.rLg)),
        child: Stack(
          children: [
            AnimatedAlign(
              duration: Ds.dur,
              curve: Ds.ease,
              alignment: Alignment(options.length == 1 ? 0 : -1 + 2 * index / (options.length - 1), 0),
              child: FractionallySizedBox(
                widthFactor: 1 / options.length,
                heightFactor: 1,
                child: Container(
                  decoration: BoxDecoration(
                    color: p.sf,
                    borderRadius: BorderRadius.circular(9),
                    boxShadow: dark
                        ? const [BoxShadow(color: Color(0x05FFFFFF), spreadRadius: 1)]
                        : const [
                            BoxShadow(color: Color(0x0F18191D), blurRadius: 2, offset: Offset(0, 1)),
                            BoxShadow(color: Color(0x0D18191D), blurRadius: 8, offset: Offset(0, 2)),
                          ],
                  ),
                ),
              ),
            ),
            Row(
              children: [
                for (final (v, l, icon) in options)
                  Expanded(
                    child: Semantics(
                      selected: v == value,
                      button: true,
                      inMutuallyExclusiveGroup: true,
                      child: InkWell(
                        borderRadius: BorderRadius.circular(9),
                        onTap: () => onChanged(v),
                        child: Center(
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              if (icon != null) ...[Icon(icon, size: 16, color: v == value ? p.tx : p.tx2), const SizedBox(width: 6)],
                              Text(
                                l,
                                style: text.bodyMedium!.copyWith(fontWeight: v == value ? FontWeight.w600 : FontWeight.w500, color: v == value ? p.tx : p.tx2),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Filter / choice chip (§7.4): 36 h, radius 999, ln2 border; selected is
/// ink-filled. An optional count sits after the label in tabular figures.
class DsChoiceChip extends StatelessWidget {
  const DsChoiceChip({super.key, required this.label, required this.selected, required this.onSelected, this.count, this.avatar, this.icon});
  final String label;
  final bool selected;
  final VoidCallback onSelected;
  final int? count;
  final Widget? avatar;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final p = DsColors.of(context);
    final style = Theme.of(context).textTheme.bodySmall!.copyWith(fontWeight: FontWeight.w500, color: selected ? p.bg : p.tx);
    return ChoiceChip(
      selected: selected,
      onSelected: (_) => onSelected(),
      visualDensity: const VisualDensity(vertical: -1),
      materialTapTargetSize: MaterialTapTargetSize.padded,
      avatar: avatar ?? (icon == null ? null : Icon(icon, size: 16, color: selected ? p.bg : p.tx2)),
      label: Text.rich(
        TextSpan(
          children: [
            TextSpan(text: label),
            if (count != null)
              TextSpan(
                text: '  ${NumberFormat.decimalPattern().format(count)}',
                style: TextStyle(color: selected ? p.bg.withValues(alpha: 0.72) : p.tx3, fontFeatures: Ds.tabular),
              ),
          ],
        ),
        style: style,
      ),
    );
  }
}

// ─── Visual bits ───────────────────────────────────────────────────────────

/// The InFrame mark (§7.16, §10): a 28 px accent square, rx 8, with four
/// frame corners in ac-tx at a 2.2 round stroke; then the 18/700 wordmark.
class Logo extends StatelessWidget {
  const Logo({super.key, this.size = 18});

  /// Wordmark size; the mark scales with it (28 at 18).
  final double size;

  @override
  Widget build(BuildContext context) {
    final p = DsColors.of(context);
    final mark = size * 28 / 18;
    return Semantics(
      label: 'InFrame',
      excludeSemantics: true,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox.square(
            dimension: mark,
            child: CustomPaint(painter: _MarkPainter(p.ac, p.acTx)),
          ),
          SizedBox(width: size * 10 / 18),
          Text(
            'InFrame',
            style: TextStyle(fontFamily: Ds.sans, fontSize: size, height: 1.2, fontWeight: FontWeight.w700, letterSpacing: -0.01 * size, color: p.tx),
          ),
        ],
      ),
    );
  }
}

class _MarkPainter extends CustomPainter {
  _MarkPainter(this.fill, this.line);
  final Color fill, line;

  @override
  void paint(Canvas canvas, Size s) {
    final u = s.width / 28;
    canvas.drawRRect(RRect.fromRectAndRadius(Offset.zero & s, Radius.circular(8 * u)), Paint()..color = fill);
    final paint = Paint()
      ..color = line
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.2 * u
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    for (final pts in const [
      [7.0, 11.0, 7.0, 7.0, 11.0, 7.0],
      [17.0, 7.0, 21.0, 7.0, 21.0, 11.0],
      [21.0, 17.0, 21.0, 21.0, 17.0, 21.0],
      [11.0, 21.0, 7.0, 21.0, 7.0, 17.0],
    ]) {
      canvas.drawPath(
        Path()
          ..moveTo(pts[0] * u, pts[1] * u)
          ..lineTo(pts[2] * u, pts[3] * u)
          ..lineTo(pts[4] * u, pts[5] * u),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _MarkPainter old) => old.fill != fill || old.line != line;
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
    final p = DsColors.of(context);
    if (url == null) {
      return ColoredBox(
        color: p.sunk,
        child: Icon(Icons.image_outlined, color: p.tx3),
      );
    }
    return CachedNetworkImage(
      imageUrl: api.resolve(url!),
      cacheKey: cacheKey ?? url!.split('?').first,
      fit: fit,
      fadeInDuration: const Duration(milliseconds: 150),
      placeholder: (_, _) => ColoredBox(color: p.sunk),
      errorWidget: (_, _, _) => ColoredBox(
        color: p.sunk,
        child: Icon(Icons.broken_image_outlined, color: p.tx3),
      ),
    );
  }
}

/// Person avatar (§7.5): a circle; initials 600 in the accent's soft tint.
class PersonAvatar extends StatelessWidget {
  const PersonAvatar({super.key, required this.name, this.url, this.size = 40, this.cacheKey});
  final String name;
  final String? url;
  final double size;
  final String? cacheKey;

  @override
  Widget build(BuildContext context) {
    final p = DsColors.of(context);
    return ClipOval(
      child: SizedBox.square(
        dimension: size,
        child: url != null
            ? NetImage(url, cacheKey: cacheKey)
            : ColoredBox(
                color: p.acSoft,
                child: Center(
                  child: Text(
                    initials(name),
                    style: TextStyle(fontWeight: FontWeight.w600, color: p.ac, fontSize: (size * 0.36).clamp(10, 22)),
                  ),
                ),
              ),
      ),
    );
  }
}

enum DsTone { neutral, accent, good, warn, crit, outline }

/// Badge / status tag (§7.4): 24 h, radius 6, 12/600, soft fill + strong text.
class DsBadge extends StatelessWidget {
  const DsBadge(this.text, {super.key, this.tone = DsTone.neutral, this.icon});
  final String text;
  final DsTone tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final p = DsColors.of(context);
    final (bg, fg) = switch (tone) {
      DsTone.neutral => (p.sunk, p.tx2),
      DsTone.accent => (p.acSoft, p.ac),
      DsTone.good => (p.goodSoft, p.good),
      DsTone.warn => (p.warnSoft, p.warn),
      DsTone.crit => (p.critSoft, p.crit),
      DsTone.outline => (Colors.transparent, p.tx2),
    };
    return Container(
      constraints: const BoxConstraints(minHeight: 24),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(Ds.rSm),
        border: tone == DsTone.outline ? Border.all(color: p.ln2) : null,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[Icon(icon, size: 14, color: fg), const SizedBox(width: 4)],
          Flexible(
            child: Text(
              text,
              style: TextStyle(fontFamily: Ds.sans, color: fg, fontSize: 12, height: 16 / 12, fontWeight: FontWeight.w600, fontFeatures: Ds.tabular),
            ),
          ),
        ],
      ),
    );
  }
}

/// Icon tile (§7.5): a rounded-10 square in a soft tint with the icon in the
/// strong tint. [onTinted] draws it on `sf` for use inside a tinted callout.
class DsIconTile extends StatelessWidget {
  const DsIconTile(this.icon, {super.key, this.tone = DsTone.accent, this.size = 40, this.onTinted = false});
  final IconData icon;
  final DsTone tone;
  final double size;
  final bool onTinted;

  @override
  Widget build(BuildContext context) {
    final p = DsColors.of(context);
    final (bg, fg) = switch (tone) {
      DsTone.accent => (p.acSoft, p.ac),
      DsTone.good => (p.goodSoft, p.good),
      DsTone.warn => (p.warnSoft, p.warn),
      DsTone.crit => (p.critSoft, p.crit),
      DsTone.neutral || DsTone.outline => (p.sunk, p.tx2),
    };
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(color: onTinted ? p.sf : bg, borderRadius: BorderRadius.circular(size >= 48 ? Ds.rLg : Ds.rMd)),
      child: Icon(icon, size: size >= 48 ? 24 : 20, color: fg),
    );
  }
}

/// Callout / banner (§7.5): radius 12, a tinted fill, an icon tile on the tint,
/// a 15/20 title, a 13/18 body, and optional trailing or bottom actions.
class DsCallout extends StatelessWidget {
  const DsCallout({super.key, required this.icon, required this.title, this.body, this.tone = DsTone.accent, this.action, this.trailing, this.onTap});
  final IconData icon;
  final String title;
  final String? body;
  final DsTone tone;

  /// Shown under the text, right-aligned.
  final Widget? action;

  /// Shown at the end of the row (e.g. a chevron or a compact button).
  final Widget? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final p = DsColors.of(context);
    final text = Theme.of(context).textTheme;
    final bg = switch (tone) {
      DsTone.accent => p.acSoft,
      DsTone.good => p.goodSoft,
      DsTone.warn => p.warnSoft,
      DsTone.crit => p.critSoft,
      DsTone.neutral || DsTone.outline => p.sunk,
    };
    final titleColor = switch (tone) {
      DsTone.warn => p.warn,
      DsTone.crit => p.crit,
      _ => p.tx,
    };
    final radius = BorderRadius.circular(Ds.rLg);
    return Material(
      color: bg,
      borderRadius: radius,
      child: InkWell(
        borderRadius: radius,
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 14, 16, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  DsIconTile(icon, tone: tone, onTinted: true),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(title, style: text.titleSmall!.copyWith(color: titleColor)),
                        if (body != null) ...[const SizedBox(height: 2), Text(body!, style: text.bodySmall!.copyWith(color: p.tx2))],
                      ],
                    ),
                  ),
                  if (trailing != null) ...[const SizedBox(width: 8), trailing!],
                ],
              ),
              if (action != null) ...[const SizedBox(height: 12), Align(alignment: Alignment.centerRight, child: action)],
            ],
          ),
        ),
      ),
    );
  }
}

/// Empty state (§7.11): a centred column with a 48 icon tile, a 15/20 title,
/// a 15/22 line of help, and one action.
class EmptyView extends StatelessWidget {
  const EmptyView({super.key, required this.icon, required this.title, this.body, this.action});
  final IconData icon;
  final String title;
  final String? body;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final p = DsColors.of(context);
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 48),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(color: p.sunk, borderRadius: BorderRadius.circular(Ds.rLg)),
            child: Icon(icon, size: 24, color: p.tx3),
          ),
          const SizedBox(height: 12),
          Text(title, textAlign: TextAlign.center, style: text.titleSmall),
          if (body != null) ...[
            const SizedBox(height: 4),
            Text(
              body!,
              textAlign: TextAlign.center,
              style: text.bodyLarge!.copyWith(color: p.tx2),
            ),
          ],
          if (action != null) ...[const SizedBox(height: 16), action!],
        ],
      ),
    );
  }
}

/// Inline alert banner (§7.11): crit-soft, radius 12, a 20 px icon.
class ErrorBox extends StatelessWidget {
  const ErrorBox(this.message, {super.key});
  final String? message;

  @override
  Widget build(BuildContext context) {
    if (message == null) return const SizedBox.shrink();
    final p = DsColors.of(context);
    return Semantics(
      liveRegion: true,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(color: p.critSoft, borderRadius: BorderRadius.circular(Ds.rLg)),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 1),
              child: Icon(Icons.error_outline, size: 20, color: p.crit),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                message!,
                style: TextStyle(fontFamily: Ds.sans, color: p.crit, fontSize: 15, height: 20 / 15, fontWeight: FontWeight.w600),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Section card (§7.5): sf, 1px ln, radius 14, no shadow; a 17/24 header.
class SectionCard extends StatelessWidget {
  const SectionCard({super.key, required this.title, this.subtitle, required this.child, this.trailing});
  final String title;
  final String? subtitle;
  final Widget child;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final p = DsColors.of(context);
    final text = Theme.of(context).textTheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Text(title, style: text.titleMedium)),
                ?trailing,
              ],
            ),
            if (subtitle != null) ...[const SizedBox(height: 2), Text(subtitle!, style: text.bodySmall!.copyWith(color: p.tx3))],
            const SizedBox(height: 12),
            child,
          ],
        ),
      ),
    );
  }
}

/// Primary button that shows a spinner while [busy].
class BusyButton extends StatelessWidget {
  const BusyButton({super.key, required this.label, required this.onPressed, this.busy = false, this.icon});
  final String label;
  final VoidCallback? onPressed;
  final bool busy;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final p = DsColors.of(context);
    return FilledButton(
      onPressed: busy ? null : onPressed,
      child: busy
          ? SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2.5, color: p.ac))
          : Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (icon != null) ...[Icon(icon, size: 18), const SizedBox(width: 8)],
                Flexible(child: Text(label, overflow: TextOverflow.ellipsis)),
              ],
            ),
    );
  }
}

/// Destructive button style (§7.1): transparent, crit text, a crit-soft border.
ButtonStyle dsDangerOutline(BuildContext context) {
  final p = DsColors.of(context);
  return OutlinedButton.styleFrom(
    backgroundColor: Colors.transparent,
    foregroundColor: p.crit,
    side: BorderSide(color: p.critSoft),
  );
}
