import 'package:flutter/material.dart';

import '../state/deep_links.dart';
import '../theme.dart';
import '../widgets/update_banner.dart';
import 'events_screen.dart';
import 'my_photos_screen.dart';
import 'people_screen.dart';
import 'settings_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _tab = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      checkForAppUpdate(context);
      // Signed in: an event link that arrived before now opens.
      DeepLinks.instance.attach();
    });
  }

  @override
  void dispose() {
    DeepLinks.instance.detach();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(index: _tab, children: const [EventsScreen(), MyPhotosScreen(), PeopleScreen(), SettingsScreen()]),
      // Bottom navigation (§6.3): sf with a top hairline, accent icon + label
      // over an ac-soft pill when selected.
      bottomNavigationBar: DecoratedBox(
        decoration: BoxDecoration(
          border: Border(top: BorderSide(color: DsColors.of(context).ln)),
        ),
        child: NavigationBar(
          selectedIndex: _tab,
          onDestinationSelected: (i) => setState(() => _tab = i),
          labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
          destinations: const [
            NavigationDestination(icon: Icon(Icons.grid_view_outlined), selectedIcon: Icon(Icons.grid_view_rounded), label: 'Events'),
            NavigationDestination(icon: Icon(Icons.photo_library_outlined), selectedIcon: Icon(Icons.photo_library), label: 'My photos'),
            NavigationDestination(icon: Icon(Icons.people_outline), selectedIcon: Icon(Icons.people), label: 'People'),
            NavigationDestination(icon: Icon(Icons.tune_outlined), selectedIcon: Icon(Icons.tune), label: 'Settings'),
          ],
        ),
      ),
    );
  }
}
