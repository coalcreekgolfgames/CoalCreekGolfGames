import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { BrandedScreen } from '@/components/BrandedScreen';
import { SectionCard } from '@/components/ui/SectionCard';
import { useAuth } from '@/providers/AuthProvider';
import { getMyTournaments } from '@/lib/tournaments';

export default function TournamentsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<any[]>([]);

  const load = useCallback(async () => {
    if (!user?.id) {
      setItems([]);
      setLoading(false);
      return;
    }

    try {
      const data = await getMyTournaments(user.id);
      setItems(data);
    } catch (error: any) {
      console.error(error?.message ?? 'Failed to load tournaments');
      setItems([]);
    }
  }, [user?.id]);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      await load();
      setLoading(false);
    };
    run();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <BrandedScreen screenName="TournamentsScreen-loading" scroll={false}>
        <View style={styles.loading}><ActivityIndicator size="large" color="#18341d" /></View>
      </BrandedScreen>
    );
  }

  return (
    <BrandedScreen screenName="TournamentsScreen" scroll={false} bodyStyle={styles.bodyWrap}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
      <Text style={styles.title}>Tournaments</Text>
      <Text style={styles.subtitle}>Open a tournament to see your event details and the live board.</Text>

      {items.length === 0 ? (
        <SectionCard>
          <Text style={styles.emptyTitle}>No active tournament memberships</Text>
          <Text style={styles.subtitle}>
            Once a player joins a tournament, they can open tournament details, live standings, and later their group view from here.
          </Text>
        </SectionCard>
      ) : (
        items.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => router.push(`/tournament/${item.id}`)}
            style={({ pressed }) => [styles.cardPressable, pressed ? styles.pressed : undefined]}
          >
            <SectionCard style={styles.tournamentCard}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardTitle}>{item.name}</Text>
                <View style={styles.statusChip}>
                  <Text style={styles.statusChipText}>{item.status}</Text>
                </View>
              </View>
              <Text style={styles.cardSub}>{item.start_date} → {item.end_date}</Text>
              <Text style={styles.meta}>Status: {item.status} · Confirmation: {item.confirmation_rule}</Text>
              <Text style={styles.openLink}>Open tournament</Text>
            </SectionCard>
          </Pressable>
        ))
      )}
    </ScrollView>
    </BrandedScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  bodyWrap: { flex: 1, padding: 16 },
  content: { gap: 16, paddingBottom: 24 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '800', color: '#132117' },
  subtitle: { fontSize: 15, color: '#5a6b61', lineHeight: 22 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#132117', marginBottom: 8 },
  cardPressable: { borderRadius: 20 },
  tournamentCard: { gap: 8 },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  cardTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: '#132117' },
  cardSub: { fontSize: 14, color: '#5a6b61', marginTop: 6 },
  meta: { fontSize: 13, color: '#5a6b61', marginTop: 8 },
  openLink: { fontSize: 14, fontWeight: '700', color: '#18341d', marginTop: 14 },
  statusChip: {
    borderRadius: 999,
    backgroundColor: '#e7eee4',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#18341d',
    textTransform: 'uppercase',
  },
  pressed: { opacity: 0.92 },
});
