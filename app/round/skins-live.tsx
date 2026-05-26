import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { BrandWatermarkBackground } from '@/components/BrandWatermarkBackground';
import { CoalCreekHeader } from '@/components/CoalCreekHeader';
import { AppButton } from '@/components/ui/AppButton';
import { SectionCard } from '@/components/ui/SectionCard';
import { TournamentQuickNav } from '@/components/navigation/TournamentQuickNav';
import { SettlementBreakdown } from '@/components/round/SettlementBreakdown';
import { formatCurrencyFromCents } from '@/lib/currency';
import { getSkinsLiveStandings, type SkinsLiveStandingRow } from '@/lib/skinsBackend';
import { loadDraftRound } from '@/lib/localRound';
import { calculateGameSettlementFromWinnings, type GameSettlement } from '@/lib/settlements';
import { getSkinsRoundGameIdForRound } from '@/lib/groupRoundCompanions';
import type { LocalRoundDraft } from '@/types/round';

export default function SkinsLiveScreen() {
  const params = useLocalSearchParams<{ roundId?: string; roundGameId?: string }>();
  const backendRoundIdParam = typeof params.roundId === 'string' ? params.roundId : null;
  const backendRoundGameIdParam = typeof params.roundGameId === 'string' ? params.roundGameId : null;
  const [round, setRound] = useState<LocalRoundDraft | null>(null);
  const [rows, setRows] = useState<SkinsLiveStandingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const unresolvedCarryover = Number(rows[0]?.unresolved_final_carryover_skin_count ?? 0);
  const buyInCents = rows[0]?.buy_in_cents ?? round?.roundGameBuyInCents ?? 0;
  const totalAwardedSkinCount = rows[0]?.total_awarded_skin_count ?? 0;
  const settlement = rows.length > 0 && unresolvedCarryover <= 0 && buyInCents > 0 && totalAwardedSkinCount > 0
    ? calculateGameSettlementFromWinnings({
      buyInCents,
      players: rows.map((row) => ({
        id: row.participant_id,
        displayName: row.display_name,
        grossWinningsCents: row.player_winnings_cents ?? 0,
      })),
    })
    : null;
  const settlementPendingText = unresolvedCarryover > 0
    ? 'Resolve the final putt-off before settlement can be calculated.'
    : null;
  const settlementEmptyText = unresolvedCarryover > 0
    ? null
    : buyInCents <= 0
      ? 'No buy-in was set for this game.'
      : totalAwardedSkinCount <= 0
        ? 'No settlement is needed.'
        : null;

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const draft = await loadDraftRound();
        if (!mounted) return;
        setRound(draft);

        const backendRoundGameId = backendRoundGameIdParam
          ?? draft?.backendRoundGameId
          ?? (backendRoundIdParam ? await getSkinsRoundGameIdForRound(backendRoundIdParam) : null);

        if (!backendRoundGameId) {
          setRows([]);
          setLoading(false);
          return;
        }

        const nextRows = await getSkinsLiveStandings(backendRoundGameId);
        if (!mounted) return;
        setRows(nextRows);
      } catch (nextError: any) {
        if (!mounted) return;
        setError(nextError?.message ?? 'Skins live standings are unavailable.');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [backendRoundGameIdParam, backendRoundIdParam]);

  return (
    <BrandWatermarkBackground style={styles.screen} screenName="SkinsLiveScreen">
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <CoalCreekHeader />
        <Text style={styles.title}>Skins Live Board</Text>
        <Text style={styles.subtitle}>
          {round?.group?.groupName ?? 'Skins'} · Shared standings from the backend Skins read model.
        </Text>

        {!round?.backendRoundGameId && !backendRoundGameIdParam && !backendRoundIdParam ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>Save a Skins hole first</Text>
            <Text style={styles.body}>The shared Skins board appears after the round has synced at least one hole to the backend.</Text>
          </SectionCard>
        ) : loading ? (
          <SectionCard>
            <Text style={styles.body}>Loading shared Skins standings...</Text>
          </SectionCard>
        ) : error ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>Skins board unavailable</Text>
            <Text style={styles.body}>{error}</Text>
          </SectionCard>
        ) : (
          <SectionCard>
            <Text style={styles.sectionTitle}>Standings</Text>
            <Text style={styles.body}>Buy-in per player: {formatCurrencyFromCents(rows[0]?.buy_in_cents ?? round?.roundGameBuyInCents ?? 0)}</Text>
            <Text style={styles.body}>Total pot: {formatCurrencyFromCents(rows[0]?.total_pot_cents ?? ((rows[0]?.buy_in_cents ?? round?.roundGameBuyInCents ?? 0) * rows.length))}</Text>
            <Text style={styles.body}>Total skins awarded: {rows[0]?.total_awarded_skin_count ?? 0}</Text>
            <Text style={styles.body}>
              {unresolvedCarryover > 0
                ? `Winnings pending until the final putt-off awards ${rows[0]?.unresolved_final_carryover_skin_count ?? 0} remaining skin${Number(rows[0]?.unresolved_final_carryover_skin_count ?? 0) === 1 ? '' : 's'}.`
                : `Skin value: ${formatCurrencyFromCents(rows[0]?.per_skin_value_cents ?? null)}`}
            </Text>
            <SettlementBreakdown
              settlement={settlement}
              unitLabel="Skin"
              pendingText={settlementPendingText}
              emptyText={settlementEmptyText}
              unitValueCents={rows[0]?.per_skin_value_cents ?? null}
            />
            {rows[0]?.skins_putt_off_winner_display_name && rows[0]?.skins_putt_off_awarded_skin_count ? (
              <Text style={styles.body}>
                Final putt-off winner: {rows[0].skins_putt_off_winner_display_name} for {rows[0].skins_putt_off_awarded_skin_count} skin{rows[0].skins_putt_off_awarded_skin_count === 1 ? '' : 's'}.
              </Text>
            ) : null}
            <View style={styles.cardList}>
              {rows.map((row) => (
                <View key={row.participant_id} style={styles.playerCard}>
                  <View style={styles.playerHeader}>
                    <Text style={styles.playerName}>{row.standing_rank}. {row.display_name}</Text>
                    <Text style={styles.playerPoints}>{row.total_skin_count_won} skins</Text>
                  </View>
                  <Text style={styles.playerMeta}>Holes won {row.skins_won}</Text>
                  <Text style={styles.playerMeta}>Gross {row.gross_total}</Text>
                  <Text style={styles.playerMeta}>{formatSettlementPlayer(settlement, row.participant_id, row.player_winnings_cents ?? null)}</Text>
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
  settlement: GameSettlement | null,
  participantId: string,
  fallbackWinningsCents: number | null,
) {
  const player = settlement?.players.find((entry) => entry.id === participantId);
  if (!player) return `Winnings ${formatCurrencyFromCents(fallbackWinningsCents)}`;
  return `Winnings ${formatCurrencyFromCents(player.grossWinningsCents)} · net ${formatCurrencyFromCents(player.netCents)}`;
}
