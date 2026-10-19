import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// InFrame's "viewfinder" palette — the same tokens as the web app.
class Palette {
  const Palette({
    required this.bg,
    required this.surface,
    required this.surface2,
    required this.ink,
    required this.ink2,
    required this.muted,
    required this.line,
    required this.accent,
    required this.accentInk,
    required this.accentSoft,
    required this.ok,
    required this.okSoft,
    required this.warn,
    required this.danger,
    required this.dangerSoft,
  });

  final Color bg, surface, surface2, ink, ink2, muted, line, accent, accentInk, accentSoft, ok, okSoft, warn, danger, dangerSoft;

  static const light = Palette(
    bg: Color(0xFFF4F2EC),
    surface: Color(0xFFFFFFFF),
    surface2: Color(0xFFEBE8E0),
    ink: Color(0xFF17161B),
    ink2: Color(0xFF3B3942),
    muted: Color(0xFF6F6A77),
    line: Color(0xFFE2DED5),
    accent: Color(0xFFF2542D),
    accentInk: Color(0xFFFFFFFF),
    accentSoft: Color(0xFFFDE8E1),
    ok: Color(0xFF1D8F61),
    okSoft: Color(0xFFDCF2E8),
    warn: Color(0xFFB97300),
    danger: Color(0xFFC93434),
    dangerSoft: Color(0xFFFBE3E3),
  );

  static const dark = Palette(
    bg: Color(0xFF0F0E12),
    surface: Color(0xFF18171C),
    surface2: Color(0xFF222027),
    ink: Color(0xFFF3F0EA),
    ink2: Color(0xFFD4D0C9),
    muted: Color(0xFF9C97A5),
    line: Color(0xFF2C2A32),
    accent: Color(0xFFFF6A47),
    accentInk: Color(0xFF160B08),
    accentSoft: Color(0xFF3A1D15),
    ok: Color(0xFF4CC493),
    okSoft: Color(0xFF143326),
    warn: Color(0xFFE7A83A),
    danger: Color(0xFFF06B6B),
    dangerSoft: Color(0xFF3D1717),
  );

  static Palette of(BuildContext context) => Theme.of(context).brightness == Brightness.dark ? dark : light;
}

ThemeData buildTheme(Brightness brightness) {
  final p = brightness == Brightness.dark ? Palette.dark : Palette.light;
  final base = ThemeData(
    useMaterial3: true,
    brightness: brightness,
    scaffoldBackgroundColor: p.bg,
    colorScheme: ColorScheme(
      brightness: brightness,
      primary: p.ink,
      onPrimary: p.bg,
      secondary: p.accent,
      onSecondary: p.accentInk,
      error: p.danger,
      onError: Colors.white,
      surface: p.surface,
      onSurface: p.ink,
      surfaceContainerHighest: p.surface2,
      outline: p.line,
    ),
  );
  final body = GoogleFonts.interTextTheme(base.textTheme).apply(bodyColor: p.ink, displayColor: p.ink);
  TextStyle? display(TextStyle? s) => s == null ? null : GoogleFonts.bricolageGrotesque(textStyle: s, fontWeight: FontWeight.w600, letterSpacing: -0.4);
  final text = body.copyWith(
    displayLarge: display(body.displayLarge),
    displayMedium: display(body.displayMedium),
    displaySmall: display(body.displaySmall),
    headlineLarge: display(body.headlineLarge),
    headlineMedium: display(body.headlineMedium),
    headlineSmall: display(body.headlineSmall),
    titleLarge: display(body.titleLarge),
  );
  final radius = BorderRadius.circular(12);
  return base.copyWith(
    textTheme: text,
    appBarTheme: AppBarTheme(
      backgroundColor: p.bg,
      foregroundColor: p.ink,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: text.titleLarge?.copyWith(fontSize: 22),
    ),
    cardTheme: CardThemeData(
      color: p.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18), side: BorderSide(color: p.line)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: p.surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: OutlineInputBorder(borderRadius: radius, borderSide: BorderSide(color: p.line)),
      enabledBorder: OutlineInputBorder(borderRadius: radius, borderSide: BorderSide(color: p.line)),
      focusedBorder: OutlineInputBorder(borderRadius: radius, borderSide: BorderSide(color: p.ink, width: 1.4)),
      errorBorder: OutlineInputBorder(borderRadius: radius, borderSide: BorderSide(color: p.danger)),
      focusedErrorBorder: OutlineInputBorder(borderRadius: radius, borderSide: BorderSide(color: p.danger, width: 1.4)),
      labelStyle: TextStyle(color: p.ink2),
      hintStyle: TextStyle(color: p.muted),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: p.ink,
        foregroundColor: p.bg,
        minimumSize: const Size(0, 48),
        shape: const StadiumBorder(),
        textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: p.ink,
        minimumSize: const Size(0, 44),
        side: BorderSide(color: p.line),
        shape: const StadiumBorder(),
        textStyle: const TextStyle(fontWeight: FontWeight.w600),
      ),
    ),
    textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(foregroundColor: p.ink)),
    chipTheme: ChipThemeData(
      backgroundColor: p.surface,
      selectedColor: p.ink,
      side: BorderSide(color: p.line),
      shape: const StadiumBorder(),
      labelStyle: TextStyle(color: p.ink2, fontWeight: FontWeight.w500),
      secondaryLabelStyle: TextStyle(color: p.bg, fontWeight: FontWeight.w500),
      showCheckmark: false,
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: p.surface,
      indicatorColor: p.surface2,
      labelTextStyle: WidgetStatePropertyAll(TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: p.ink2)),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: p.ink,
      contentTextStyle: TextStyle(color: p.bg),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    ),
    dividerTheme: DividerThemeData(color: p.line, space: 1),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: p.accent),
  );
}
