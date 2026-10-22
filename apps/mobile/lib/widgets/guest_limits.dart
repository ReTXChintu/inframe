import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api/models.dart';
import '../theme.dart';
import 'common.dart';

const _gb = 1024 * 1024 * 1024;

/// "300 files · 2 GB" (what each guest may add in all), or "No limit".
String guestLimitLabel(int? maxItems, int? maxBytes) {
  final parts = [if (maxItems != null) plural(maxItems, 'file'), if (maxBytes != null) formatBytes(maxBytes)];
  return parts.isEmpty ? 'No limit' : parts.join(' · ');
}

/// What a guest may still add to the event; null when nothing is limited.
String? allowanceText(GuestAllowance a) {
  if (!a.limited) return null;
  if (a.exhausted) return "You've reached what this event allows each guest to add.";
  final parts = [if (a.itemsLeft != null) plural(a.itemsLeft!, 'more file'), if (a.bytesLeft != null) '${formatBytes(a.bytesLeft)} left'];
  return 'You can add ${parts.join(' · ')}.';
}

/// The guest's remaining allowance on the upload screen: quiet while there's
/// room, a warning once it's used up.
class GuestAllowanceCard extends StatelessWidget {
  const GuestAllowanceCard(this.allowance, {super.key});
  final GuestAllowance allowance;

  @override
  Widget build(BuildContext context) {
    final text = allowanceText(allowance);
    if (text == null) return const SizedBox.shrink();
    final exhausted = allowance.exhausted;
    return DsCallout(
      icon: exhausted ? Icons.block_outlined : Icons.data_usage_outlined,
      tone: exhausted ? DsTone.warn : DsTone.neutral,
      title: text,
      body: exhausted ? 'The host sets how much each guest can add. Ask them if you have more to share.' : null,
    );
  }
}

/// Owner only: change how much each guest may add. Pops with the fields to
/// PATCH (`guestMaxItems` / `guestMaxBytes`, null = no limit), or null if dismissed.
Future<Map<String, dynamic>?> showGuestLimitSheet(BuildContext context, {required int? maxItems, required int? maxBytes}) {
  return showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _GuestLimitSheet(maxItems: maxItems, maxBytes: maxBytes),
  );
}

class _GuestLimitSheet extends StatefulWidget {
  const _GuestLimitSheet({required this.maxItems, required this.maxBytes});
  final int? maxItems;
  final int? maxBytes;

  @override
  State<_GuestLimitSheet> createState() => _GuestLimitSheetState();
}

class _GuestLimitSheetState extends State<_GuestLimitSheet> {
  late bool _itemsOn = widget.maxItems != null;
  late bool _bytesOn = widget.maxBytes != null;
  late final _items = TextEditingController(text: '${widget.maxItems ?? 300}');
  late final _gbText = TextEditingController(text: _gbLabel(widget.maxBytes ?? 2 * _gb));

  static String _gbLabel(int bytes) {
    final gb = bytes / _gb;
    return gb == gb.roundToDouble() ? '${gb.round()}' : gb.toStringAsFixed(2);
  }

  int? get _itemsValue => int.tryParse(_items.text.trim());
  double? get _gbValue => double.tryParse(_gbText.text.trim().replaceAll(',', '.'));
  bool get _valid => (!_itemsOn || (_itemsValue ?? 0) >= 1) && (!_bytesOn || (_gbValue ?? 0) > 0);

  @override
  void dispose() {
    _items.dispose();
    _gbText.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = DsColors.of(context);
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.viewInsetsOf(context).bottom + MediaQuery.paddingOf(context).bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const DsIconTile(Icons.data_usage_outlined),
                const SizedBox(width: 12),
                Expanded(child: Text('Each guest can add up to', style: Theme.of(context).textTheme.titleLarge)),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              'Counted per guest across the whole event. Hosts are never limited.',
              style: Theme.of(context).textTheme.bodyMedium!.copyWith(color: p.tx2),
            ),
            const SizedBox(height: 8),
            SwitchListTile(
              key: const ValueKey('limit-items-on'),
              contentPadding: EdgeInsets.zero,
              title: const Text('Limit the number of files'),
              value: _itemsOn,
              onChanged: (v) => setState(() => _itemsOn = v),
            ),
            if (_itemsOn)
              DsTextField(
                key: const ValueKey('limit-items'),
                controller: _items,
                label: 'Files per guest',
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                onChanged: (_) => setState(() {}),
                error: _itemsOn && (_itemsValue ?? 0) < 1 ? 'At least 1.' : null,
              ),
            SwitchListTile(
              key: const ValueKey('limit-bytes-on'),
              contentPadding: EdgeInsets.zero,
              title: const Text('Limit the total size'),
              value: _bytesOn,
              onChanged: (v) => setState(() => _bytesOn = v),
            ),
            if (_bytesOn)
              DsTextField(
                key: const ValueKey('limit-gb'),
                controller: _gbText,
                label: 'GB per guest',
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                onChanged: (_) => setState(() {}),
                error: _bytesOn && (_gbValue ?? 0) <= 0 ? 'More than 0.' : null,
              ),
            const SizedBox(height: 20),
            FilledButton(
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
              onPressed: _valid
                  ? () => Navigator.pop(context, <String, dynamic>{
                        'guestMaxItems': _itemsOn ? _itemsValue : null,
                        'guestMaxBytes': _bytesOn ? (_gbValue! * _gb).round() : null,
                      })
                  : null,
              child: const Text('Save limit'),
            ),
          ],
        ),
      ),
    );
  }
}
