import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { resolveActiveLiveBoardRoute } from '@/lib/currentRound';
import { loadActiveDraftRound, subscribeDraftRound } from '@/lib/localRound';
import type { LocalRoundDraft } from '@/types/round';

type TabBarProps = {
  state: {
    index: number;
    routes: Array<{ key: string; name: string }>;
  };
  navigation: {
    navigate: (name: string) => void;
  };
};

type TabRouteName = 'home' | 'round' | 'history' | 'tournaments' | 'notes' | 'profile' | 'help' | 'stats';

type PlayerBottomNavProps = Partial<TabBarProps>;

type MenuItem = {
  route: TabRouteName;
  label: string;
  subtitle: string;
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
};

type DirectItem = {
  route: string;
  label: string;
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  kind: 'tab' | 'live-board' | 'more';
};

const BASE_DIRECT_ITEMS: DirectItem[] = [
  { route: 'home', label: 'Home', icon: 'home-filled', kind: 'tab' },
  { route: 'round', label: 'Live Round', icon: 'flag-circle', kind: 'tab' },
  { route: 'history', label: 'History', icon: 'history', kind: 'tab' },
  { route: 'more', label: 'More', icon: 'menu', kind: 'more' },
];

const MORE_ITEMS: MenuItem[] = [
  { route: 'tournaments', label: 'Tournaments', subtitle: 'Current events, pairings, and leaderboards.', icon: 'emoji-events' },
  { route: 'stats', label: 'Stats', subtitle: 'Personal scoring trends from completed rounds.', icon: 'insert-chart' },
  { route: 'notes', label: 'Notes', subtitle: 'Round notes and quick references.', icon: 'sticky-note-2' },
  { route: 'profile', label: 'Profile', subtitle: 'Account and app identity.', icon: 'person' },
  { route: 'help', label: 'Help', subtitle: 'How to use the app and game guide.', icon: 'help' },
];

const TAB_ROUTE_PATHS: Record<TabRouteName, '/(tabs)/home' | '/(tabs)/round' | '/(tabs)/history' | '/(tabs)/tournaments' | '/(tabs)/notes' | '/(tabs)/profile' | '/(tabs)/help' | '/(tabs)/stats'> = {
  home: '/(tabs)/home',
  round: '/(tabs)/round',
  history: '/(tabs)/history',
  tournaments: '/(tabs)/tournaments',
  notes: '/(tabs)/notes',
  profile: '/(tabs)/profile',
  help: '/(tabs)/help',
  stats: '/(tabs)/stats',
};

function resolveStandaloneActiveRoute(pathname: string): TabRouteName | null {
  if (pathname === '/(tabs)/home' || pathname === '/home') return 'home';
  if (pathname === '/(tabs)/round' || pathname === '/round') return 'round';
  if (pathname === '/(tabs)/history' || pathname === '/history') return 'history';
  if (pathname === '/(tabs)/tournaments' || pathname === '/tournaments') return 'tournaments';
  if (pathname === '/(tabs)/notes' || pathname === '/notes') return 'notes';
  if (pathname === '/(tabs)/profile' || pathname === '/profile') return 'profile';
  if (pathname === '/(tabs)/help' || pathname === '/help') return 'help';
  if (pathname === '/(tabs)/stats' || pathname === '/stats') return 'stats';
  return null;
}

function MenuRow({ item, onPress }: { item: MenuItem; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuRow, pressed ? styles.menuRowPressed : null]}>
      <View style={styles.menuIconWrap}>
        <MaterialIcons name={item.icon} size={18} color="#18341d" />
      </View>
      <View style={styles.menuTextWrap}>
        <Text style={styles.menuLabel}>{item.label}</Text>
        <Text style={styles.menuSubtitle}>{item.subtitle}</Text>
      </View>
      <MaterialIcons name="chevron-right" size={20} color="#7a847c" />
    </Pressable>
  );
}

export function PlayerBottomNav({ state, navigation }: PlayerBottomNavProps) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const [menuVisible, setMenuVisible] = useState(false);
  const [draftRound, setDraftRound] = useState<LocalRoundDraft | null>(null);
  const activeRoute = state?.routes?.[state.index]?.name ?? resolveStandaloneActiveRoute(pathname);
  const liveBoardTarget = useMemo(() => resolveActiveLiveBoardRoute(draftRound), [draftRound]);
  const directItems = useMemo(() => {
    const items = [...BASE_DIRECT_ITEMS];
    if (liveBoardTarget) {
      items.splice(items.length - 1, 0, {
        route: liveBoardTarget.route,
        label: liveBoardTarget.label,
        icon: 'leaderboard',
        kind: 'live-board',
      });
    }
    return items;
  }, [liveBoardTarget]);

  useEffect(() => {
    let active = true;

    const syncDraftRound = async () => {
      const nextRound = await loadActiveDraftRound();
      if (!active) return;
      setDraftRound(nextRound);
    };

    void syncDraftRound();
    const unsubscribe = subscribeDraftRound(() => {
      void syncDraftRound().catch(() => {});
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const goToTab = (route: TabRouteName) => {
    if (navigation) {
      navigation.navigate(route);
      return;
    }
    router.push(TAB_ROUTE_PATHS[route]);
  };

  const goTo = (route: TabRouteName) => {
    setMenuVisible(false);
    goToTab(route);
  };

  return (
    <>
      <View style={[styles.barWrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <View style={styles.bar}>
          {directItems.map((item) => {
            const liveBoardActivePath = item.kind === 'live-board' ? item.route.split('?')[0] : null;
            const isActive =
              item.kind === 'live-board'
                ? pathname === liveBoardActivePath
                : activeRoute === item.route;
            const onPress = item.kind === 'more'
              ? () => setMenuVisible(true)
              : item.kind === 'live-board'
                ? () => router.push(item.route as any)
                : () => goToTab(item.route as TabRouteName);

            return (
              <Pressable
                key={item.route}
                onPress={onPress}
                style={({ pressed }) => [
                  styles.tabButton,
                  isActive ? styles.tabButtonActive : null,
                  pressed ? styles.tabButtonPressed : null,
                ]}
              >
                <MaterialIcons
                  name={item.icon}
                  size={20}
                  color={isActive ? '#fffdf8' : '#18341d'}
                />
                <Text style={[styles.tabLabel, isActive ? styles.tabLabelActive : null]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Modal visible={menuVisible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setMenuVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setMenuVisible(false)}>
          <Pressable style={styles.modalSheet} onPress={(event) => event.stopPropagation?.()}>
            <Text style={styles.modalEyebrow}>More</Text>
            <Text style={styles.modalTitle}>Coal Creek Menu</Text>
            <View style={styles.menuStack}>
              {MORE_ITEMS.map((item) => (
                <MenuRow key={item.route} item={item} onPress={() => goTo(item.route)} />
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  barWrap: {
    backgroundColor: 'rgba(244,240,231,0.98)',
    borderTopWidth: 1,
    borderTopColor: '#d9d1c3',
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  bar: {
    flexDirection: 'row',
    gap: 8,
  },
  tabButton: {
    flex: 1,
    minHeight: 58,
    borderRadius: 18,
    backgroundColor: '#fffdf8',
    borderWidth: 1,
    borderColor: '#d9d1c3',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  tabButtonActive: {
    backgroundColor: '#18341d',
    borderColor: '#18341d',
  },
  tabButtonPressed: {
    opacity: 0.92,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#18341d',
  },
  tabLabelActive: {
    color: '#fffdf8',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(7,10,8,0.52)',
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: 16,
  },
  modalSheet: {
    width: '100%',
    borderRadius: 24,
    backgroundColor: '#f4f0e7',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    gap: 12,
  },
  modalEyebrow: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    color: '#6d786f',
    letterSpacing: 1,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#132117',
  },
  menuStack: {
    gap: 10,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    backgroundColor: '#fffdf8',
    borderWidth: 1,
    borderColor: '#ddd5c8',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  menuRowPressed: {
    opacity: 0.92,
  },
  menuIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#e7eee4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuTextWrap: {
    flex: 1,
    gap: 2,
  },
  menuLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: '#132117',
  },
  menuSubtitle: {
    fontSize: 12,
    color: '#6d786f',
  },
});
