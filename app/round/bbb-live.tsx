import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { BrandWatermarkBackground } from '@/components/BrandWatermarkBackground';
import { CoalCreekHeader } from '@/components/CoalCreekHeader';
import { AppButton } from '@/components/ui/AppButton';
import { SectionCard } from '@/components/ui/SectionCard';
import { TournamentQuickNav } from '@/components/navigation/TournamentQuickNav';
import { SettlementBreakdown } from '@/components/round/SettlementBreakdown';
import { getBbbLiveStandings, type BbbLiveStandingRow } from '@/lib/bbbBackend';
import { formatCurrencyFromCents } from '@/lib/currency';
import { loadDraftRound } from '@/lib/localRound';
import { calculateGameSettlement } from '@/lib/settlements';
import type { LocalRoundDraft } from '@/types/round';

export default function BbbLiveScreen() {
  const params = useLocalSearchParams<{ roundId?: string }>();
  const backendRoundIdParam = typeof params.roundId === 'string' ? params.roundId : null;
  const [round, setRound] = useState<LocalRoundDraft | null>(null);
  const [rows, setRows] = useState<BbbLiveStandingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const backendBuyInCents = rows.find((row) => row.buy_in_cents != null)?.buy_in_cents ?? null;
  const settlement = rows.length > 0
    ? calculateGameSettlement({
      buyInCents: backendBuyInCents ?? round?.roundGameBuyInCents ?? 0,
      players: rows.map((row) => ({
        id: row.participant_id,
        displayName: row.display_name,
        units: row.total_bbb_points,
      })),
    })
    : null;

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const draft = await loadDraftRound();
        if (!mounted) return;
        setRound(draft);

        const backendRoundId = backendRoundIdParam ?? draft?.backendRoundId ?? null;

        if (!backendRoundId) {
          setRows([]);
          setLoading(false);
          return;
        }

        const nextRows = await getBbbLiveStandings(backendRoundId);
        if (!mounted) return;
        setRows(nextRows);
      } catch (nextError: any) {
        if (!mounted) return;
        setError(nextError?.message ?? 'BBB live standings are unavailable.');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [backendRoundIdParam]);

  return (
    <BrandWatermarkBackground style={styles.screen} screenName="BbbLiveScreen">
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <CoalCreekHeader />
        <Text style={styles.title}>BBB Live Board</Text>
        <Text style={styles.subtitle}>
          {round?.group?.groupName ?? 'Bingo Bango Bongo'} · Shared standings from the backend BBB read model.
        </Text>

        {!round?.backendRoundId && !backendRoundIdParam ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>Save a BBB hole first</Text>
            <Text style={styles.body}>The shared BBB board appears after the round has synced at least one hole to the backend.</Text>
          </SectionCard>
        ) : loading ? (
          <SectionCard>
            <Text style={styles.body}>Loading shared BBB standings...</Text>
          </SectionCard>
        ) : error ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>BBB board unavailable</Text>
            <Text style={styles.body}>{error}</Text>
          </SectionCard>
        ) : (
          <SectionCard>
            <Text style={styles.sectionTitle}>Standings</Text>
            <SettlementBreakdown settlement={settlement} unitLabel="BBB point" />
            <View style={styles.cardList}>
              {rows.map((row) => (
                <View key={row.participant_id} style={styles.playerCard}>
                  <View style={styles.playerHeader}>
                    <Text style={styles.playerName}>{row.standing_rank}. {row.display_name}</Text>
                    <Text style={styles.playerPoints}>{row.total_bbb_points} pts</Text>
                  </View>
                  <Text style={styles.playerMeta}>Bingo {row.bingo_count} · Bango {row.bango_count} · Bongo {row.bongo_count}</Text>
                  <Text style={styles.playerMeta}>Strokes {row.stroke_total}</Text>
                  <Text style={styles.playerMeta}>{formatSettlementPlayer(settlement, row.participant_id)}</Text>
                </View>
              ))}
            </View>
          </SectionCard>
        )}

        <AppButton title="Back to round" onPress={() => router.back()} variant="secondary" />
      </ScrollView>
      <TournamentQuickNav />
    </BrandWatermarkBackground>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 16, gap: 16, paddingBottom: 112 },
  title: { fontSize: 28, fontWeight: '800', color: '#132117' },
  subtitle: { fontSize: 15, color: '#5a6b61', lineHeight: 22 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: '#132117', marginBottom: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#132117', marginBottom: 8 },
  body: { fontSize: 14, color: '#5a6b61', lineHeight: 21 },
  cardList: { gap: 10, marginTop: 6 },
  playerCard: { backgroundColor: '#eef3ec', borderRadius: 16, padding: 12, gap: 4 },
  playerHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  playerName: { fontSize: 16, fontWeight: '800', color: '#132117', flex: 1 },
  playerPoints: { fontSize: 16, fontWeight: '800', color: '#132117' },
  playerMeta: { fontSize: 13, color: '#5a6b61' },
});

function formatSettlementPlayer(
  settlement: ReturnType<typeof calculateGameSettlement> | null,
  participantId: string,
) {
  const player = settlement?.players.find((entry) => entry.id === participantId);
  if (!player) return 'Winnings $0.00';
  return `Winnings ${formatCurrencyFromCents(player.grossWinningsCents)} · net ${formatCurrencyFromCents(player.netCents)}`;
}
