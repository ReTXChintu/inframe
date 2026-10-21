import 'package:flutter/material.dart';

/// Shared design tokens (docs/design-system.md §3, §9.4): the same neutrals,
/// semantics and type as SpendLog and Trippin, with InFrame's violet accent.
/// Field names mirror the CSS custom properties so design and code read the same.
@immutable
class DsColors extends ThemeExtension<DsColors> {
  const DsColors({
    required this.canvas,
    required this.bg,
    required this.sf,
    required this.sf2,
    required this.sunk,
    required this.ln,
    required this.ln2,
    required this.tx,
    required this.tx2,
    required this.tx3,
    required this.ac,
    required this.acTx,
    required this.acSoft,
    required this.acLine,
    required this.good,
    required this.goodSoft,
    required this.warn,
    required this.warnFill,
    required this.warnSoft,
    required this.crit,
    required this.critFill,
    required this.critSoft,
    required this.hatch,
    required this.scrim,
    required this.chart,
  });

  final Color canvas, bg, sf, sf2, sunk, ln, ln2, tx, tx2, tx3;
  final Color ac, acTx, acSoft, acLine;
  final Color good, goodSoft, warn, warnFill, warnSoft, crit, critFill, critSoft, hatch, scrim;
  final List<Color> chart; // c1..c5, other (c1 = the app's accent)

  Color get moneyOut => tx;
  Color get moneyIn => good;
  Color get moneyNeutral => tx3;

  /// Light theme, InFrame violet accent (§10).
  static const light = DsColors(
    canvas: Color(0xFFE4E1D8),
    bg: Color(0xFFF4F2EC),
    sf: Color(0xFFFFFFFF),
    sf2: Color(0xFFFAF9F5),
    sunk: Color(0xFFECE9E1),
    ln: Color(0xFFE2DED4),
    ln2: Color(0xFFC7C2B5),
    tx: Color(0xFF18191D),
    tx2: Color(0xFF4C4D53),
    tx3: Color(0xFF67686E),
    ac: Color(0xFF6A3FC4),
    acTx: Color(0xFFFFFFFF),
    acSoft: Color(0xFFEEE8FB),
    acLine: Color(0xFFCFC0F1),
    good: Color(0xFF15724A),
    goodSoft: Color(0xFFE1F0E6),
    warn: Color(0xFF8F5200),
    warnFill: Color(0xFFE39A2E),
    warnSoft: Color(0xFFFBEED6),
    crit: Color(0xFFB3302A),
    critFill: Color(0xFFD9473E),
    critSoft: Color(0xFFFBE5E2),
    hatch: Color(0xFFC7C2B5),
    scrim: Color(0x6B18191D), // rgba(24,25,29,.42)
    chart: [Color(0xFF6A3FC4), Color(0xFFC7792B), Color(0xFF2F8A7A), Color(0xFFB04A6F), Color(0xFF6A7A2F), Color(0xFF8A8780)],
  );

  /// Dark theme, InFrame violet accent (§10).
  static const dark = DsColors(
    canvas: Color(0xFF08090A),
    bg: Color(0xFF111214),
    sf: Color(0xFF1A1B1E),
    sf2: Color(0xFF202125),
    sunk: Color(0xFF0C0D0F),
    ln: Color(0xFF2B2D32),
    ln2: Color(0xFF3D3F46),
    tx: Color(0xFFEDEBE6),
    tx2: Color(0xFFBEBCB6),
    tx3: Color(0xFF9A9893),
    ac: Color(0xFFBBA4FF),
    acTx: Color(0xFF1C0F3D),
    acSoft: Color(0xFF251D3D),
    acLine: Color(0xFF463878),
    good: Color(0xFF56C892),
    goodSoft: Color(0xFF12291D),
    warn: Color(0xFFF2B661),
    warnFill: Color(0xFFE9A240),
    warnSoft: Color(0xFF2E2312),
    crit: Color(0xFFFF8C80),
    critFill: Color(0xFFE45B50),
    critSoft: Color(0xFF341A19),
    hatch: Color(0xFF4A4C53),
    scrim: Color(0x99000000), // rgba(0,0,0,.6)
    chart: [Color(0xFFBBA4FF), Color(0xFFC7792B), Color(0xFF2F8A7A), Color(0xFFB04A6F), Color(0xFF6A7A2F), Color(0xFF8A8780)],
  );

  /// The tokens for [context]. Falls back to the built-in light/dark set when
  /// the surrounding theme wasn't built with [dsTheme] (e.g. widget tests).
  static DsColors of(BuildContext context) {
    final theme = Theme.of(context);
    return theme.extension<DsColors>() ?? (theme.brightness == Brightness.dark ? dark : light);
  }

  /// Per-app accent override (§10).
  DsColors withAccent({required Color ac, required Color acTx, required Color acSoft, required Color acLine}) =>
      copyWith(ac: ac, acTx: acTx, acSoft: acSoft, acLine: acLine, chart: [ac, ...chart.skip(1)]);

  @override
  DsColors copyWith({Color? ac, Color? acTx, Color? acSoft, Color? acLine, List<Color>? chart}) => DsColors(
    canvas: canvas,
    bg: bg,
    sf: sf,
    sf2: sf2,
    sunk: sunk,
    ln: ln,
    ln2: ln2,
    tx: tx,
    tx2: tx2,
    tx3: tx3,
    ac: ac ?? this.ac,
    acTx: acTx ?? this.acTx,
    acSoft: acSoft ?? this.acSoft,
    acLine: acLine ?? this.acLine,
    good: good,
    goodSoft: goodSoft,
    warn: warn,
    warnFill: warnFill,
    warnSoft: warnSoft,
    crit: crit,
    critFill: critFill,
    critSoft: critSoft,
    hatch: hatch,
    scrim: scrim,
    chart: chart ?? this.chart,
  );

  @override
  DsColors lerp(ThemeExtension<DsColors>? other, double t) {
    if (other is! DsColors) return this;
    Color l(Color a, Color b) => Color.lerp(a, b, t)!;
    return DsColors(
      canvas: l(canvas, other.canvas),
      bg: l(bg, other.bg),
      sf: l(sf, other.sf),
      sf2: l(sf2, other.sf2),
      sunk: l(sunk, other.sunk),
      ln: l(ln, other.ln),
      ln2: l(ln2, other.ln2),
      tx: l(tx, other.tx),
      tx2: l(tx2, other.tx2),
      tx3: l(tx3, other.tx3),
      ac: l(ac, other.ac),
      acTx: l(acTx, other.acTx),
      acSoft: l(acSoft, other.acSoft),
      acLine: l(acLine, other.acLine),
      good: l(good, other.good),
      goodSoft: l(goodSoft, other.goodSoft),
      warn: l(warn, other.warn),
      warnFill: l(warnFill, other.warnFill),
      warnSoft: l(warnSoft, other.warnSoft),
      crit: l(crit, other.crit),
      critFill: l(critFill, other.critFill),
      critSoft: l(critSoft, other.critSoft),
      hatch: l(hatch, other.hatch),
      scrim: l(scrim, other.scrim),
      chart: [for (var i = 0; i < chart.length; i++) l(chart[i], other.chart[i])],
    );
  }
}

/// Spacing, radii, durations (§5).
abstract final class Ds {
  static const s2 = 2.0, s4 = 4.0, s6 = 6.0, s8 = 8.0, s10 = 10.0, s12 = 12.0, s14 = 14.0, s16 = 16.0, s20 = 20.0, s24 = 24.0, s32 = 32.0;
  static const rXs = 3.0, rSm = 6.0, rMd = 10.0, rLg = 12.0, rXl = 14.0, r2xl = 16.0, r3xl = 20.0;
  static const pagePadPhone = 16.0, pagePadTablet = 24.0, pagePadDesktop = 32.0;
  static const durFast = Duration(milliseconds: 120), dur = Duration(milliseconds: 200), durSlow = Duration(milliseconds: 280);
  static const ease = Cubic(.2, 0, 0, 1);
  static const tabular = [FontFeature.tabularFigures(), FontFeature.liningFigures()];

  static const sans = 'IBM Plex Sans';
  static const mono = 'IBM Plex Mono';

  /// The photo viewer's backdrop: always dark, whatever the theme (= dark `canvas`).
  static const stage = Color(0xFF08090A);

  /// Side padding for the current width: 16 on phones, 24 on tablets, 32 on desktop.
  static double pagePad(BuildContext context) {
    final w = MediaQuery.sizeOf(context).width;
    return w >= 1024
        ? pagePadDesktop
        : w >= 600
        ? pagePadTablet
        : pagePadPhone;
  }
}

TextTheme dsTextTheme(Color tx, Color tx2) {
  const f = Ds.sans;
  TextStyle s(double size, double lh, FontWeight w, {double em = 0, Color? c}) =>
      TextStyle(fontFamily: f, fontSize: size, height: lh / size, fontWeight: w, letterSpacing: em * size, color: c ?? tx);
  return TextTheme(
    displayLarge: s(44, 52, FontWeight.w600, em: -0.02), // hero figure
    displayMedium: s(40, 48, FontWeight.w600, em: -0.02),
    displaySmall: s(34, 40, FontWeight.w600, em: -0.02), // big figure; phone hero
    headlineLarge: s(28, 34, FontWeight.w600, em: -0.02),
    headlineMedium: s(26, 32, FontWeight.w600, em: -0.02),
    headlineSmall: s(22, 28, FontWeight.w600), // page title, stat value
    titleLarge: s(19, 26, FontWeight.w600), // dialog title
    titleMedium: s(17, 24, FontWeight.w600), // section header
    titleSmall: s(15, 20, FontWeight.w600), // card / row title
    bodyLarge: s(15, 22, FontWeight.w400),
    bodyMedium: s(14, 20, FontWeight.w400),
    bodySmall: s(13, 18, FontWeight.w400, c: tx2),
    labelLarge: s(15, 20, FontWeight.w600), // buttons
    labelMedium: s(12, 16, FontWeight.w600, em: 0.02, c: tx2), // field labels, eyebrows
    labelSmall: s(11, 14, FontWeight.w600, c: tx2),
  );
}

ThemeData dsTheme(DsColors c, Brightness b) {
  final scheme = ColorScheme(
    brightness: b,
    primary: c.ac,
    onPrimary: c.acTx,
    primaryContainer: c.acSoft,
    onPrimaryContainer: c.ac,
    secondary: c.tx,
    onSecondary: c.bg,
    secondaryContainer: c.sunk,
    onSecondaryContainer: c.tx,
    tertiary: c.good,
    onTertiary: c.sf,
    tertiaryContainer: c.goodSoft,
    onTertiaryContainer: c.good,
    error: c.crit,
    onError: c.sf,
    errorContainer: c.critSoft,
    onErrorContainer: c.crit,
    surface: c.sf,
    onSurface: c.tx,
    onSurfaceVariant: c.tx2,
    surfaceContainerLowest: c.sf,
    surfaceContainerLow: c.sf2,
    surfaceContainer: c.sf2,
    surfaceContainerHigh: c.sf2,
    surfaceContainerHighest: c.sunk,
    outline: c.ln2,
    outlineVariant: c.ln,
    inverseSurface: c.tx,
    onInverseSurface: c.bg,
    inversePrimary: b == Brightness.light ? DsColors.dark.ac : DsColors.light.ac,
    shadow: const Color(0xFF18191D),
    scrim: c.scrim,
    surfaceTint: Colors.transparent,
  );
  final text = dsTextTheme(c.tx, c.tx2);
  final r10 = BorderRadius.circular(Ds.rMd), r12 = BorderRadius.circular(Ds.rLg), r14 = BorderRadius.circular(Ds.rXl);
  OutlineInputBorder ob(Color col, double w) => OutlineInputBorder(
    borderRadius: r10,
    borderSide: BorderSide(color: col, width: w),
  );

  return ThemeData(
    useMaterial3: true,
    brightness: b,
    colorScheme: scheme,
    scaffoldBackgroundColor: c.bg,
    canvasColor: c.bg,
    fontFamily: Ds.sans,
    textTheme: text,
    extensions: [c],
    splashFactory: InkRipple.splashFactory,
    dividerTheme: DividerThemeData(color: c.ln, thickness: 1, space: 1),
    appBarTheme: AppBarTheme(
      backgroundColor: c.bg,
      foregroundColor: c.tx,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleSpacing: Ds.pagePadPhone,
      titleTextStyle: text.headlineSmall,
      iconTheme: IconThemeData(color: c.tx2, size: 22),
      actionsIconTheme: IconThemeData(color: c.tx2, size: 22),
    ),
    cardTheme: CardThemeData(
      color: c.sf,
      elevation: 0,
      margin: EdgeInsets.zero,
      shadowColor: Colors.transparent,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: r14,
        side: BorderSide(color: c.ln),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: c.ac,
        foregroundColor: c.acTx,
        disabledBackgroundColor: c.sunk,
        disabledForegroundColor: c.tx3,
        minimumSize: const Size(64, 48),
        padding: const EdgeInsets.symmetric(horizontal: 20),
        shape: RoundedRectangleBorder(borderRadius: r12),
        textStyle: text.labelLarge,
        elevation: 0,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        backgroundColor: c.sf,
        foregroundColor: c.tx,
        side: BorderSide(color: c.ln2),
        minimumSize: const Size(64, 48),
        padding: const EdgeInsets.symmetric(horizontal: 20),
        shape: RoundedRectangleBorder(borderRadius: r12),
        textStyle: text.labelLarge,
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: c.ac,
        minimumSize: const Size(48, 48),
        padding: const EdgeInsets.symmetric(horizontal: 16),
        shape: RoundedRectangleBorder(borderRadius: r12),
        textStyle: text.labelLarge!.copyWith(fontSize: 14),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(foregroundColor: c.tx2, minimumSize: const Size(48, 48)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: c.sf,
      isDense: false,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 15), // 52 px with 15/22 text
      hintStyle: text.bodyLarge!.copyWith(color: c.tx3),
      labelStyle: text.bodyLarge!.copyWith(color: c.tx3),
      floatingLabelStyle: text.labelMedium!.copyWith(color: c.ac),
      helperStyle: text.bodySmall!.copyWith(fontSize: 12, height: 16 / 12, color: c.tx3),
      errorStyle: text.bodySmall!.copyWith(fontSize: 12, height: 16 / 12, color: c.crit),
      counterStyle: text.bodySmall!.copyWith(fontSize: 12, height: 16 / 12, color: c.tx3),
      border: ob(c.ln2, 1),
      enabledBorder: ob(c.ln2, 1),
      focusedBorder: ob(c.ac, 2),
      errorBorder: ob(c.crit, 2),
      focusedErrorBorder: ob(c.crit, 2),
      disabledBorder: ob(c.ln, 1),
      suffixIconColor: c.tx2,
      prefixIconColor: c.tx3,
    ),
    chipTheme: ChipThemeData(
      backgroundColor: c.sf,
      selectedColor: c.tx,
      disabledColor: c.sunk,
      labelStyle: text.bodySmall!.copyWith(fontWeight: FontWeight.w500, color: c.tx),
      secondaryLabelStyle: text.bodySmall!.copyWith(fontWeight: FontWeight.w500, color: c.bg),
      side: WidgetStateBorderSide.resolveWith((s) => BorderSide(color: s.contains(WidgetState.selected) ? c.tx : c.ln2)),
      shape: const StadiumBorder(),
      showCheckmark: false,
      checkmarkColor: c.bg,
      iconTheme: IconThemeData(size: 16, color: c.tx2),
      padding: const EdgeInsets.symmetric(horizontal: 6),
      labelPadding: const EdgeInsets.symmetric(horizontal: 6),
      elevation: 0,
      pressElevation: 0,
    ),
    switchTheme: SwitchThemeData(
      trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? c.ac : c.ln2),
      thumbColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? c.acTx : c.sf),
      trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent),
      thumbIcon: const WidgetStatePropertyAll(Icon(null)),
    ),
    checkboxTheme: CheckboxThemeData(
      fillColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? c.ac : c.sf),
      checkColor: WidgetStatePropertyAll(c.acTx),
      side: BorderSide(color: c.ln2, width: 1.5),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
    ),
    radioTheme: RadioThemeData(fillColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? c.ac : c.ln2)),
    dialogTheme: DialogThemeData(
      backgroundColor: c.sf,
      elevation: 0,
      shadowColor: Colors.transparent,
      surfaceTintColor: Colors.transparent,
      barrierColor: c.scrim,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Ds.r3xl)),
      titleTextStyle: text.titleLarge!.copyWith(height: 24 / 19),
      contentTextStyle: text.bodyLarge!.copyWith(color: c.tx2),
      actionsPadding: const EdgeInsets.fromLTRB(24, 0, 24, 20),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: c.sf,
      modalBackgroundColor: c.sf,
      modalBarrierColor: c.scrim,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      modalElevation: 0,
      showDragHandle: true,
      dragHandleColor: c.ln2,
      dragHandleSize: const Size(36, 4),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(Ds.r3xl))),
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: c.sf,
      surfaceTintColor: Colors.transparent,
      elevation: 8,
      shadowColor: Colors.black.withValues(alpha: 0.2),
      shape: RoundedRectangleBorder(
        borderRadius: r12,
        side: BorderSide(color: c.ln),
      ),
      textStyle: text.bodyMedium,
      labelTextStyle: WidgetStatePropertyAll(text.bodyMedium),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: c.tx,
      contentTextStyle: text.bodyMedium!.copyWith(color: c.bg),
      actionTextColor: c.bg,
      behavior: SnackBarBehavior.floating,
      insetPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      shape: RoundedRectangleBorder(borderRadius: r12),
    ),
    bannerTheme: MaterialBannerThemeData(
      backgroundColor: c.acSoft,
      contentTextStyle: text.bodyMedium!.copyWith(color: c.tx, fontWeight: FontWeight.w500),
      dividerColor: c.ln,
      elevation: 0,
      surfaceTintColor: Colors.transparent,
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: c.sf,
      indicatorColor: c.acSoft,
      indicatorShape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Ds.r2xl)),
      height: 64,
      elevation: 0,
      surfaceTintColor: Colors.transparent,
      labelTextStyle: WidgetStateProperty.resolveWith(
        (s) => text.labelMedium!.copyWith(letterSpacing: 0, color: s.contains(WidgetState.selected) ? c.ac : c.tx2),
      ),
      iconTheme: WidgetStateProperty.resolveWith((s) => IconThemeData(size: 24, color: s.contains(WidgetState.selected) ? c.ac : c.tx2)),
    ),
    listTileTheme: ListTileThemeData(
      minVerticalPadding: 12,
      minTileHeight: 64,
      iconColor: c.tx2,
      titleTextStyle: text.bodyMedium!.copyWith(fontWeight: FontWeight.w500, fontSize: 15, height: 20 / 15),
      subtitleTextStyle: text.bodySmall!.copyWith(color: c.tx3),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(
      color: c.ac,
      linearTrackColor: c.sunk,
      circularTrackColor: Colors.transparent,
      linearMinHeight: 6,
      borderRadius: BorderRadius.circular(3),
      refreshBackgroundColor: c.sf,
    ),
    tooltipTheme: TooltipThemeData(
      decoration: BoxDecoration(color: c.tx, borderRadius: BorderRadius.circular(Ds.rMd)),
      textStyle: text.bodySmall!.copyWith(color: c.bg),
    ),
    floatingActionButtonTheme: FloatingActionButtonThemeData(
      backgroundColor: c.ac,
      foregroundColor: c.acTx,
      elevation: 0,
      focusElevation: 0,
      hoverElevation: 0,
      highlightElevation: 0,
      extendedTextStyle: text.labelLarge,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Ds.r2xl)),
    ),
    datePickerTheme: DatePickerThemeData(
      backgroundColor: c.sf,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Ds.r3xl)),
      headerBackgroundColor: c.sf,
      headerForegroundColor: c.tx,
      todayBorder: BorderSide(color: c.ac, width: 2),
      dayStyle: text.bodyMedium!.copyWith(fontFeatures: Ds.tabular),
    ),
    textSelectionTheme: TextSelectionThemeData(cursorColor: c.ac, selectionColor: c.acLine, selectionHandleColor: c.ac),
  );
}

/// InFrame's light or dark theme.
ThemeData buildTheme(Brightness brightness) => dsTheme(brightness == Brightness.dark ? DsColors.dark : DsColors.light, brightness);
