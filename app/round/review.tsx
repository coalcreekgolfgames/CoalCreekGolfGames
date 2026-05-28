import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { BrandWatermarkBackground } from '@/components/BrandWatermarkBackground';
import { CoalCreekHeader } from '@/components/CoalCreekHeader';
import { AppButton } from '@/components/ui/AppButton';
import { PlayerBottomNav } from '@/components/navigation/PlayerBottomNav';
import { SectionCard } from '@/components/ui/SectionCard';
import { SettlementBreakdown } from '@/components/round/SettlementBreakdown';
import { teeDisplayLabel } from '@/constants/course';
import {
  bbbWinnerLabel,
  ensureGroupScoresForHole,
  isBingoBangoBongoRound,
  summarizeBingoBangoBongo,
} from '@/lib/bingoBangoBongo';
import { getBbbLiveStandings, type BbbLiveStandingRow } from '@/lib/bbbBackend';
import { deleteCurrentRound, getDeleteCurrentRoundMessage } from '@/lib/currentRound';
import { formatCurrencyFromCents } from '@/lib/currency';
import { getGroupRoundOfficialScoringGuard } from '@/lib/groupRoundCompanions';
import { clearDraftRound, loadDraftRound, saveCompletedRound, saveDraftRound } from '@/lib/localRound';
import {
  getRegularRoundBackendGameType,
  getRegularRoundBackendStatusDetail,
  getRegularRoundBackendStatusLabel,
  markRegularRoundSyncFailure,
  runRegularRoundFinalSyncLoop,
} from '@/lib/regularRoundBackendSync';
import { finalizeHoleStats, summarizeRound } from '@/lib/roundStats';
import { isSkinsRound, summarizeSkins } from '@/lib/skins';
import { calculateGameSettlement, calculateGameSettlementFromWinnings } from '@/lib/settlements';
import {
  applyStablefordToHole,
  describeStablefordMode,
  getStablefordModifiedPresetSummary,
  getStablefordRoundTotal,
  isStablefordRound,
} from '@/lib/stableford';
import { holes } from '@/constants/course';
import { finalizeTournamentRoundSync } from '@/lib/tournamentRoundSync';
import { useAuth } from '@/providers/AuthProvider';
import { getSkinsHistorySummary, resolveSkinsPuttOff, type SkinsHistorySummary } from '@/lib/skinsBackend';
import type { LocalRoundDraft, SavedRound } from '@/types/round';

function formatHandicapNumber(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function summaryTitle(round: LocalRoundDraft) {
  if (round.roundMode === 'tournament' && round.tournamentFormat === 'scramble') return 'Scramble round summary';
  if (round.roundMode === 'tournament' && round.tournamentFormat === 'ironman_team_scramble') return 'Ironman round summary';
  if (round.roundMode === 'tournament') return 'Tournament round summary';
  if (round.roundMode === 'casual_group' && round.groupGameMode === 'bingo_bango_bongo') return 'Bingo Bango Bongo summary';
  if (round.roundMode === 'casual_group' && round.groupGameMode === 'skins') return 'Skins summary';
  if (round.roundMode === 'casual_group' && round.groupGameMode === 'nassau') return 'Nassau summary';
  if (round.roundMode === 'casual_group') return 'Group round summary';
  return 'Round summary';
}

function recapScoreLabel(round: LocalRoundDraft) {
  if (round.roundMode === 'tournament' && round.tournamentFormat === 'scramble') return 'Team Score';
  if (round.roundMode === 'tournament' && round.tournamentFormat === 'ironman_team_scramble') return 'Our Score';
  if (round.roundMode === 'casual_group' && round.groupGameMode === 'skins') return 'My Score';
  return 'Score';
}

function isCrossCardDualScoreRound(round: LocalRoundDraft) {
  return (
    round.roundMode === 'tournament' &&
    round.tournamentFormat === 'individual_stroke_play' &&
    round.tournamentScoringFormat !== 'stableford' &&
    !!round.tournamentCrossCardTargetUserId
  );
}

function formatTeeTime(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(`1970-01-01T${value}`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function ReviewRoundScreen() {
  const { user, loading: authLoading } = useAuth();
  const [round, setRound] = useState<LocalRoundDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [bbbBackendRows, setBbbBackendRows] = useState<BbbLiveStandingRow[]>([]);
  const [skinsBackendSummary, setSkinsBackendSummary] = useState<SkinsHistorySummary | null>(null);
  const [selectedSkinsPuttOffWinnerId, setSelectedSkinsPuttOffWinnerId] = useState<string | null>(null);
  const [resolvingSkinsPuttOff, setResolvingSkinsPuttOff] = useState(false);
  const [finalSyncMessage, setFinalSyncMessage] = useState<string | null>(null);
  const [checkingEntryAccess, setCheckingEntryAccess] = useState(true);
  const [entryBlockedMessage, setEntryBlockedMessage] = useState<string | null>(null);
  const cancelFinalSyncRef = useRef(false);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (authLoading) {
        if (active) {
          setCheckingEntryAccess(true);
          setEntryBlockedMessage(null);
        }
        return;
      }

      const draft = await loadDraftRound();
      if (!draft) {
        if (active) {
          setRound(null);
          setCheckingEntryAccess(false);
        }
        return;
      }

      const guard = await getGroupRoundOfficialScoringGuard({
        round: draft,
        userId: user?.id,
        authLoading,
      });

      if (!active) return;

      if (guard.status !== 'allow_official') {
        if (guard.redirectRoute) {
          router.replace(guard.redirectRoute as any);
          return;
        }
        setEntryBlockedMessage(guard.message ?? 'This shared group round is unavailable.');
        setCheckingEntryAccess(false);
        return;
      }

      const finalizedHoles = draft.holes.map((hole) => {
        const courseHole = holes.find((item) => item.hole === hole.hole);
        const finalizedHole = courseHole ? finalizeHoleStats(hole, courseHole.par) : hole;
        return applyStablefordToHole(draft, finalizedHole);
      });
      setRound({
        ...draft,
        holes: finalizedHoles,
        tournamentStablefordTotal: getStablefordRoundTotal({ ...draft, holes: finalizedHoles }),
      });
      setEntryBlockedMessage(null);
      setCheckingEntryAccess(false);
    };

    void load();
    return () => {
      active = false;
    };
  }, [authLoading, user?.id]);

  const summary = useMemo(() => {
    if (!round) return null;
    return summarizeRound(round.holes);
  }, [round]);

  useEffect(() => {
    let active = true;

    const loadBbbBackendRows = async () => {
      if (!round || !isBingoBangoBongoRound(round) || !round.backendRoundId) {
        if (active) setBbbBackendRows([]);
        return;
      }

      try {
        const rows = await getBbbLiveStandings(round.backendRoundId);
        if (!active) return;
        setBbbBackendRows(rows);
      } catch (error: any) {
        if (!active) return;
        console.error(error?.message ?? 'BBB review standings unavailable');
        setBbbBackendRows([]);
      }
    };

    loadBbbBackendRows();
    return () => {
      active = false;
    };
  }, [round]);

  useEffect(() => {
    let active = true;

    const loadSkinsBackendSummary = async () => {
      if (!round || !isSkinsRound(round) || !round.backendRoundGameId) {
        if (active) setSkinsBackendSummary(null);
        return;
      }

      try {
        const nextSummary = await getSkinsHistorySummary(round.backendRoundGameId);
        if (!active) return;
        setSkinsBackendSummary(nextSummary);
      } catch (error: any) {
        if (!active) return;
        console.error(error?.message ?? 'Skins review summary unavailable');
        setSkinsBackendSummary(null);
      }
    };

    loadSkinsBackendSummary();
    return () => {
      active = false;
    };
  }, [round]);

  const handleSave = async () => {
    if (!round || !summary) return;

    const guard = await getGroupRoundOfficialScoringGuard({
      round,
      userId: user?.id,
      authLoading: false,
    });

    if (guard.status !== 'allow_official') {
      if (guard.redirectRoute) {
        router.replace(guard.redirectRoute as any);
        return;
      }
      Alert.alert('Round unavailable', guard.message ?? 'This shared group round is not available for official scoring.');
      return;
    }

    setSaving(true);
    cancelFinalSyncRef.current = false;
    setFinalSyncMessage(null);

    try {
      if (skinsRound) {
        const unresolvedCarryoverSkinCount = skinsBackendSummary?.unresolved_final_carryover_skin_count
          ?? skinsSummary?.payout.unresolvedFinalCarryoverSkinCount
          ?? 0;

        if (unresolvedCarryoverSkinCount > 0) {
          Alert.alert(
            'Resolve Skins putt-off',
            round.backendRoundGameId
              ? `Hole 18 still carries ${unresolvedCarryoverSkinCount} skin${unresolvedCarryoverSkinCount === 1 ? '' : 's'}. Resolve the putt-off before finishing this round.`
              : 'Hole 18 still has unresolved Skins carryover. Sync the round first so the putt-off winner can be saved.',
          );
          return;
        }
      }

      const regularRoundBackendGameType = getRegularRoundBackendGameType(round);

      if (round.tournamentId && round.backendRoundId && user?.id) {
        await finalizeTournamentRoundSync({
          round,
          userId: user.id,
        });

        await clearDraftRound();
        Alert.alert(
          'Tournament round synced',
          round.statsEnabled === false
            ? 'Scores were sent and the round was finished as a score-only round. Local round data was removed after backend save succeeded.'
            : 'Scores were sent hole by hole, full stats posted at round end, and the local round was removed after backend save succeeded.',
          [{ text: 'Back to tournament', onPress: () => router.replace(`/tournament/${round.tournamentId}/yardage`) }],
        );
        return;
      }

      let roundToSave: LocalRoundDraft = round;
      const historySavedAt = new Date().toISOString();
      const saveHistorySnapshot = async (nextRound: LocalRoundDraft) => {
        const record: SavedRound = { ...nextRound, savedAt: historySavedAt, ...summary };
        await saveCompletedRound(record);
      };

      if (regularRoundBackendGameType) {
        if (!user?.id) {
          roundToSave = markRegularRoundSyncFailure(round, 'You must be signed in to save this game to the backend.');
          const localOnlyRecord: SavedRound = { ...roundToSave, savedAt: new Date().toISOString(), ...summary };
          await saveCompletedRound(localOnlyRecord);
          Alert.alert(
            'Not saved to backend',
            'This game is in History on this device only. Sign in and retry the backend save from History later.',
            [{ text: 'Go to Home', onPress: () => router.replace('/(tabs)/home') }],
          );
          return;
        }

        await saveHistorySnapshot(roundToSave);
        setFinalSyncMessage('Waiting to sync');
        const syncResult = await runRegularRoundFinalSyncLoop({
          round,
          userId: user.id,
          persist: async (nextRound) => {
            setRound(nextRound);
            await saveDraftRound(nextRound);
            await saveHistorySnapshot(nextRound);
            setFinalSyncMessage(getRegularRoundBackendStatusDetail(nextRound) ?? 'Waiting to sync');
          },
          onUpdate: (nextRound) => {
            setRound(nextRound);
            setFinalSyncMessage(getRegularRoundBackendStatusDetail(nextRound) ?? 'Waiting to sync');
          },
          shouldCancel: () => cancelFinalSyncRef.current,
        });

        roundToSave = syncResult.round;

        if (syncResult.cancelled) {
          const cancelledRecord: SavedRound = { ...roundToSave, savedAt: new Date().toISOString(), ...summary };
          await saveCompletedRound(cancelledRecord);
          Alert.alert(
            'Backend sync cancelled',
            'This game is in History, but it is not saved to the backend yet. You can retry it from History later.',
            [{ text: 'Go to Home', onPress: () => router.replace('/(tabs)/home') }],
          );
          return;
        }
      }

      const record: SavedRound = { ...roundToSave, savedAt: historySavedAt, ...summary };
      await saveCompletedRound(record);
      Alert.alert(
        regularRoundBackendGameType ? 'Round saved to backend' : 'Round saved',
        regularRoundBackendGameType
          ? 'This game was saved to the backend and added to History.'
          : round.statsEnabled === false
            ? 'The round is now in local history as a score-only round.'
            : 'The round is now in local history with score and stats.',
        [{ text: 'Go to Home', onPress: () => router.replace('/(tabs)/home') }],
      );
    } catch (error: any) {
      console.error(error?.message ?? 'Final round save failed');
      Alert.alert(
        'Final save failed',
        'The round is still on this device so you do not lose data. Try the final save again when the backend is reachable.',
      );
    } finally {
      setSaving(false);
      setFinalSyncMessage(null);
    }
  };

  const handleCancelFinalSync = () => {
    cancelFinalSyncRef.current = true;
    setFinalSyncMessage('Not saved to backend. Ending sync after the current attempt.');
  };

  const handleResolveSkinsPuttOff = async () => {
    if (!round) return;

    const awardedSkinCount = skinsBackendSummary?.unresolved_final_carryover_skin_count
      ?? skinsSummary?.payout.unresolvedFinalCarryoverSkinCount
      ?? 0;

    if (!round.backendRoundGameId) {
      Alert.alert('Backend sync required', 'Save the Skins round to the backend before resolving a final-hole putt-off.');
      return;
    }

    if (!selectedSkinsPuttOffWinnerId) {
      Alert.alert('Choose a winner', 'Select the player who won the putt-off.');
      return;
    }

    if (awardedSkinCount <= 0) {
      Alert.alert('No carryover to resolve', 'This Skins round does not have unresolved final-hole carryover.');
      return;
    }

    setResolvingSkinsPuttOff(true);

    try {
      await resolveSkinsPuttOff({
        round,
        winnerParticipantId: selectedSkinsPuttOffWinnerId,
        awardedSkinCount,
      });

      const resolvedAt = new Date().toISOString();
      const nextRound: LocalRoundDraft = {
        ...round,
        skinsPuttOffWinnerId: selectedSkinsPuttOffWinnerId,
        skinsPuttOffAwardedCount: awardedSkinCount,
        skinsPuttOffResolvedAt: resolvedAt,
      };

      setRound(nextRound);
      await saveDraftRound(nextRound);

      const refreshedSummary = await getSkinsHistorySummary(round.backendRoundGameId);
      setSkinsBackendSummary(refreshedSummary);
      setSelectedSkinsPuttOffWinnerId(null);

      const winnerName = round.group?.participants.find((participant) => participant.id === nextRound.skinsPuttOffWinnerId)?.displayName ?? 'Winner';
      Alert.alert(
        'Putt-off resolved',
        `${winnerName} was awarded the remaining ${awardedSkinCount} skin${awardedSkinCount === 1 ? '' : 's'}.`,
      );
    } catch (error: any) {
      console.error(error?.message ?? 'Skins putt-off resolution failed');
      Alert.alert(
        'Could not save putt-off',
        error?.message ?? 'Try the putt-off resolution again when the backend is reachable.',
      );
    } finally {
      setResolvingSkinsPuttOff(false);
    }
  };

  const handleDiscard = async () => {
    await clearDraftRound();
    router.replace('/(tabs)/home');
  };

  const handleDeleteCurrentRound = () => {
    if (!round || round.roundMode === 'tournament') return;

    Alert.alert(
      'Delete current round?',
      getDeleteCurrentRoundMessage(round),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Round',
          style: 'destructive',
          onPress: async () => {
            const result = await deleteCurrentRound(round);
            router.replace('/(tabs)/home');

            if (result.backendCleanupError) {
              Alert.alert(
                'Round deleted from this device',
                'The current round was cleared locally, but backend draft cleanup did not finish.',
              );
            }
          },
        },
      ],
    );
  };

  if (checkingEntryAccess) {
    return <BrandWatermarkBackground screenName="ReviewRoundScreen-loading"><View style={styles.loading}><Text style={styles.subtitle}>Checking group-round access...</Text></View></BrandWatermarkBackground>;
  }

  if (entryBlockedMessage) {
    return <BrandWatermarkBackground screenName="ReviewRoundScreen-blocked"><View style={styles.loading}><Text style={styles.subtitle}>{entryBlockedMessage}</Text></View></BrandWatermarkBackground>;
  }

  if (!round || !summary) {
    return <BrandWatermarkBackground screenName="ReviewRoundScreen-empty"><View style={styles.loading}><Text style={styles.subtitle}>No draft round found.</Text></View></BrandWatermarkBackground>;
  }

  const statsEnabled = round.statsEnabled !== false;
  const scoreLabel = recapScoreLabel(round);
  const isIronman = round.roundMode === 'tournament' && round.tournamentFormat === 'ironman_team_scramble';
  const isScramble = round.roundMode === 'tournament' && round.tournamentFormat === 'scramble';
  const isCrossCardDualScore = isCrossCardDualScoreRound(round);
  const stablefordRound = isStablefordRound(round) && !isIronman && !isScramble;
  const stablefordModeLabel = stablefordRound ? describeStablefordMode(round) : null;
  const stablefordPresetSummary = stablefordRound ? getStablefordModifiedPresetSummary(round) : null;
  const stablefordTotal = stablefordRound ? getStablefordRoundTotal(round) : null;
  const bbbRound = isBingoBangoBongoRound(round);
  const bbbSummary = bbbRound ? summarizeBingoBangoBongo(round) : null;
  const bbbBackendBuyInCents = bbbBackendRows.find((row) => row.buy_in_cents != null)?.buy_in_cents ?? null;
  const bbbBackendSettlement = bbbBackendRows.length > 0
    ? calculateGameSettlement({
      buyInCents: bbbBackendBuyInCents ?? round.roundGameBuyInCents ?? 0,
      players: bbbBackendRows.map((row) => ({
        id: row.participant_id,
        displayName: row.display_name,
        units: row.total_bbb_points,
      })),
    })
    : null;
  const bbbSettlement = bbbBackendSettlement ?? bbbSummary?.payout.settlement ?? null;
  const skinsRound = isSkinsRound(round);
  const skinsSummary = skinsRound ? summarizeSkins(round) : null;

  const openHoleEditor = async (targetHole: number) => {
    const guard = await getGroupRoundOfficialScoringGuard({
      round,
      userId: user?.id,
      authLoading,
    });

    if (guard.status !== 'allow_official' && guard.redirectRoute) {
      router.replace(guard.redirectRoute as any);
      return;
    }

    if (guard.status !== 'allow_official') {
      Alert.alert('Round unavailable', guard.message ?? 'This shared group round is not available for official scoring.');
      return;
    }

    router.replace(`/round/hole/${targetHole}` as any);
  };
  const skinsBuyInCents = skinsRound ? (round.roundGameBuyInCents ?? 0) : 0;
  const skinsTotalPotCents = skinsBuyInCents * (round.group?.participants.length ?? 0);
  const skinsUnresolvedCarryoverSkinCount = skinsBackendSummary?.unresolved_final_carryover_skin_count
    ?? skinsSummary?.payout.unresolvedFinalCarryoverSkinCount
    ?? 0;
  const skinsTotalAwardedSkinCount = skinsBackendSummary?.total_awarded_skin_count
    ?? skinsSummary?.payout.totalAwardedSkinCount
    ?? 0;
  const skinsSkinValueCents = skinsBackendSummary?.per_skin_value_cents
    ?? skinsSummary?.payout.perSkinValueCents
    ?? null;
  const skinsResolvedPuttOffWinnerId = skinsBackendSummary?.skins_putt_off_winner_participant_id
    ?? round.skinsPuttOffWinnerId
    ?? null;
  const skinsResolvedPuttOffWinnerName = skinsBackendSummary?.skins_putt_off_winner_display_name
    ?? round.group?.participants?.find((participant) => participant.id === skinsResolvedPuttOffWinnerId)?.displayName
    ?? null;
  const skinsResolvedPuttOffAwardedCount = skinsBackendSummary?.skins_putt_off_awarded_skin_count
    ?? round.skinsPuttOffAwardedCount
    ?? null;
  const skinsSettlement = skinsBackendSummary?.standings.length
    ? (
      skinsUnresolvedCarryoverSkinCount <= 0 && skinsBuyInCents > 0 && skinsTotalAwardedSkinCount > 0
        ? calculateGameSettlementFromWinnings({
          buyInCents: skinsBuyInCents,
          players: skinsBackendSummary.standings.map((row) => ({
            id: row.participant_id,
            displayName: row.display_name,
            grossWinningsCents: row.player_winnings_cents ?? 0,
          })),
        })
        : null
    )
    : (skinsSummary?.payout.settlement ?? null);
  const skinsSettlementPendingText = skinsUnresolvedCarryoverSkinCount > 0
    ? 'Resolve the final putt-off before settlement can be calculated.'
    : null;
  const skinsSettlementEmptyText = skinsUnresolvedCarryoverSkinCount > 0
    ? null
    : skinsBuyInCents <= 0
      ? 'No buy-in was set for this game.'
      : skinsTotalAwardedSkinCount <= 0
        ? 'No settlement is needed.'
        : null;
  const regularRoundBackendStatusLabel = getRegularRoundBackendStatusLabel(round);
  const regularRoundBackendStatusDetail = getRegularRoundBackendStatusDetail(round);
  const tournamentContextLine = round.roundMode === 'tournament'
    ? (isIronman || isScramble
        ? [
            round.tournamentTeamName ? `Team ${round.tournamentTeamName}` : null,
            round.startingHole ? `Start Hole ${round.startingHole}` : null,
            isIronman && round.tournamentOpponentTeamName ? `Opponent ${round.tournamentOpponentTeamName}` : null,
          ].filter(Boolean).join(' · ')
        : [
            round.tournamentPlayGroupName ? `Group ${round.tournamentPlayGroupName}` : null,
            round.tournamentTeeTime ? `Tee Time ${formatTeeTime(round.tournamentTeeTime)}` : null,
            round.tournamentCrossCardTargetName ? `Cross-Card ${round.tournamentCrossCardTargetName}` : null,
          ].filter(Boolean).join(' · '))
    : '';

  return (
    <BrandWatermarkBackground style={styles.screen} screenName="ReviewRoundScreen">
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <CoalCreekHeader />
        <Text style={styles.title}>{summaryTitle(round)}</Text>
        <Text style={styles.subtitle}>{round.date} · {teeDisplayLabel(round.tee)} · {round.ratingType}</Text>
        {round.group?.groupName ? <Text style={styles.contextText}>{round.group.groupName}</Text> : null}
        {tournamentContextLine ? <Text style={styles.contextText}>{tournamentContextLine}</Text> : null}
        {regularRoundBackendStatusLabel ? (
          <SectionCard>
            <Text style={styles.sectionTitle}>{regularRoundBackendStatusLabel}</Text>
            <Text style={styles.noStatsText}>{regularRoundBackendStatusDetail ?? 'This round is not saved to the backend yet.'}</Text>
          </SectionCard>
        ) : null}
        {finalSyncMessage ? (
          <SectionCard>
            <Text style={styles.sectionTitle}>Backend Sync</Text>
            <Text style={styles.noStatsText}>{finalSyncMessage}</Text>
          </SectionCard>
        ) : null}

        {bbbRound ? (
          <SectionCard>
            <View style={styles.heroScoreWrap}>
              <Text style={styles.heroScore}>{bbbSummary?.completedHoleCount ?? 0}</Text>
              <Text style={styles.heroLabel}>BBB Holes Recorded</Text>
            </View>
            <Text style={styles.noStatsText}>
              Each hole keeps every player score plus the manually selected Bingo, Bango, and Bongo winners.
            </Text>
            <SettlementBreakdown settlement={bbbSettlement} unitLabel="BBB point" />
            {round.backendRoundId ? (
              <View style={styles.actions}>
                <AppButton title="Open BBB Live Board" onPress={() => router.push('/round/bbb-live' as any)} variant="secondary" style={{ flex: 1 }} />
                <AppButton title="Open BBB History" onPress={() => router.push(`/round/history/${round.id}` as any)} variant="secondary" style={{ flex: 1 }} />
              </View>
            ) : null}
            <View style={styles.bbbLeaderGrid}>
              {(bbbSummary?.totals ?? []).map((row) => (
                <View key={row.participantId} style={styles.bbbLeaderCard}>
                  <Text style={styles.bbbLeaderName}>{row.displayName}</Text>
                  <Text style={styles.bbbLeaderPoints}>{row.total} BBB pts</Text>
                  <Text style={styles.bbbLeaderMeta}>Bingo {row.bingo} · Bango {row.bango} · Bongo {row.bongo}</Text>
                  <Text style={styles.bbbLeaderMeta}>Strokes {row.strokeTotal}</Text>
                </View>
              ))}
            </View>
          </SectionCard>
        ) : skinsRound ? (
          <SectionCard>
            <View style={styles.heroScoreWrap}>
              <Text style={styles.heroScore}>{skinsBackendSummary?.standings[0]?.total_skin_count_won ?? skinsSummary?.totals[0]?.totalSkinCountWon ?? 0}</Text>
              <Text style={styles.heroLabel}>Leader Skins Won</Text>
            </View>
            <Text style={styles.noStatsText}>
              Gross scoring only. Tied low scores push the skin forward until a later hole has a unique winner.
            </Text>
            <Text style={styles.bbbLeaderMeta}>Buy-in per player {formatCurrencyFromCents(skinsBackendSummary?.buy_in_cents ?? skinsBuyInCents)}</Text>
            <Text style={styles.bbbLeaderMeta}>Total pot {formatCurrencyFromCents(skinsBackendSummary?.total_pot_cents ?? skinsTotalPotCents)}</Text>
            <Text style={styles.bbbLeaderMeta}>Total skins awarded {skinsTotalAwardedSkinCount}</Text>
            <Text style={styles.bbbLeaderMeta}>
              {skinsUnresolvedCarryoverSkinCount > 0
                ? `Winnings pending: ${skinsUnresolvedCarryoverSkinCount} skin${skinsUnresolvedCarryoverSkinCount === 1 ? '' : 's'} still need a final-hole putt-off.`
                : `Skin value ${formatCurrencyFromCents(skinsSkinValueCents)}`}
            </Text>
            <SettlementBreakdown
              settlement={skinsSettlement}
              unitLabel="Skin"
              pendingText={skinsSettlementPendingText}
              emptyText={skinsSettlementEmptyText}
              unitValueCents={skinsSkinValueCents}
            />
            {skinsResolvedPuttOffWinnerName && skinsResolvedPuttOffAwardedCount ? (
              <Text style={styles.bbbLeaderMeta}>
                Final putt-off winner {skinsResolvedPuttOffWinnerName} for {skinsResolvedPuttOffAwardedCount} skin{skinsResolvedPuttOffAwardedCount === 1 ? '' : 's'}.
              </Text>
            ) : null}
            {skinsUnresolvedCarryoverSkinCount > 0 ? (
              <View style={styles.puttOffCard}>
                <Text style={styles.sectionTitle}>Resolve by putt-off</Text>
                <Text style={styles.noStatsText}>
                  Hole 18 ended with {skinsUnresolvedCarryoverSkinCount} carried skin{skinsUnresolvedCarryoverSkinCount === 1 ? '' : 's'} still unresolved. Pick the putt-off winner to finalize payouts.
                </Text>
                <View style={styles.puttOffGrid}>
                  {(round.group?.participants ?? []).map((participant) => (
                    <AppButton
                      key={`skins-putt-off-${participant.id}`}
                      title={participant.displayName}
                      onPress={() => setSelectedSkinsPuttOffWinnerId(participant.id)}
                      variant={selectedSkinsPuttOffWinnerId === participant.id ? 'primary' : 'secondary'}
                      style={styles.puttOffButton}
                    />
                  ))}
                </View>
                <AppButton
                  title={resolvingSkinsPuttOff ? 'Saving putt-off...' : 'Award Remaining Skins'}
                  onPress={handleResolveSkinsPuttOff}
                  disabled={resolvingSkinsPuttOff}
                />
              </View>
            ) : null}
            {round.backendRoundGameId ? (
              <View style={styles.actions}>
                <AppButton title="Open Skins Live Board" onPress={() => router.push('/round/skins-live' as any)} variant="secondary" style={{ flex: 1 }} />
                <AppButton title="Open Skins History" onPress={() => router.push(`/round/skins-history/${round.id}` as any)} variant="secondary" style={{ flex: 1 }} />
              </View>
            ) : null}
            <View style={styles.bbbLeaderGrid}>
              {(skinsBackendSummary?.standings ?? []).length > 0
                ? skinsBackendSummary?.standings.map((row) => (
                  <View key={row.participant_id} style={styles.bbbLeaderCard}>
                    <Text style={styles.bbbLeaderName}>{row.standing_rank}. {row.display_name}</Text>
                    <Text style={styles.bbbLeaderPoints}>{row.total_skin_count_won} skins</Text>
                    <Text style={styles.bbbLeaderMeta}>Holes won {row.skins_won}</Text>
                    <Text style={styles.bbbLeaderMeta}>Gross {row.gross_total}</Text>
                    <Text style={styles.bbbLeaderMeta}>Winnings {formatCurrencyFromCents(row.player_winnings_cents)}</Text>
                  </View>
                ))
                : (skinsSummary?.totals ?? []).map((row) => (
                <View key={row.participantId} style={styles.bbbLeaderCard}>
                  <Text style={styles.bbbLeaderName}>{row.standingRank}. {row.displayName}</Text>
                  <Text style={styles.bbbLeaderPoints}>{row.totalSkinCountWon} skins</Text>
                  <Text style={styles.bbbLeaderMeta}>Holes won {row.skinsWon}</Text>
                  <Text style={styles.bbbLeaderMeta}>Gross {row.grossTotal}</Text>
                  <Text style={styles.bbbLeaderMeta}>
                    Winnings {formatCurrencyFromCents(
                      skinsSkinValueCents === null || skinsSkinValueCents === undefined
                        ? null
                        : row.totalSkinCountWon * skinsSkinValueCents
                    )}
                  </Text>
                </View>
              ))}
            </View>
          </SectionCard>
        ) : round.groupGameMode === 'nassau' ? (
          <SectionCard>
            <View style={styles.heroScoreWrap}>
              <Text style={styles.heroScore}>{round.nassauParticipantIds?.length ?? round.group?.participants.length ?? 0}</Text>
              <Text style={styles.heroLabel}>Nassau Players</Text>
            </View>
            <Text style={styles.noStatsText}>
              Nassau tracks Front 9, Back 9, and Overall 18 for the selected buy-in players only. Tied segments split that segment share.
            </Text>
            <Text style={styles.bbbLeaderMeta}>Buy-in per player {formatCurrencyFromCents(round.roundGameBuyInCents ?? 0)}</Text>
            <Text style={styles.bbbLeaderMeta}>
              Total pot {formatCurrencyFromCents((round.roundGameBuyInCents ?? 0) * ((round.nassauParticipantIds?.length ?? 0) || (round.group?.participants.length ?? 0)))}
            </Text>
            {round.backendRoundGameId ? (
              <View style={styles.actions}>
                <AppButton title="Open Nassau Live Board" onPress={() => router.push('/round/nassau-live' as any)} variant="secondary" style={{ flex: 1 }} />
                <AppButton title="Open Nassau History" onPress={() => router.push(`/round/nassau-history/${round.id}` as any)} variant="secondary" style={{ flex: 1 }} />
              </View>
            ) : null}
          </SectionCard>
        ) : (
          <SectionCard>
            <View style={styles.heroScoreWrap}>
              <Text style={styles.heroScore}>{summary.totalScore}</Text>
              <Text style={styles.heroLabel}>
                {round.roundMode === 'tournament' && (isScramble || isIronman)
                  ? `${round.tournamentTeamName ?? 'Team'} Total Score`
                  : 'Total Score'}
              </Text>
            </View>

            {statsEnabled ? (
              <View style={styles.grid}>
                <View style={styles.box}><Text style={styles.value}>{summary.totalPutts}</Text><Text style={styles.label}>Total Putts</Text></View>
                <View style={styles.box}><Text style={styles.value}>{summary.onePutts}</Text><Text style={styles.label}>One-Putts</Text></View>
                <View style={styles.box}><Text style={styles.value}>{summary.threePutts}</Text><Text style={styles.label}>Three-Putts</Text></View>
                <View style={styles.box}><Text style={styles.value}>{summary.upAndDowns}</Text><Text style={styles.label}>Up & Down</Text></View>
                <View style={styles.box}><Text style={styles.value}>{summary.fairwaysHit}</Text><Text style={styles.label}>Fairways</Text></View>
                <View style={styles.box}><Text style={styles.value}>{summary.greensInRegulation}</Text><Text style={styles.label}>GIR</Text></View>
              </View>
            ) : (
              <Text style={styles.noStatsText}>
                {isScramble
                  ? 'Scramble score-only round - only the team score was tracked.'
                  : isIronman
                    ? 'Ironman score-only round - our score and their score were tracked hole by hole.'
                    : 'Score-only round - only strokes were tracked.'}
              </Text>
            )}
          </SectionCard>
        )}

        {stablefordRound ? (
          <SectionCard>
            <Text style={styles.sectionTitle}>{stablefordModeLabel}</Text>
            <View style={styles.heroScoreWrap}>
              <Text style={styles.heroScore}>{stablefordTotal ?? 0}</Text>
              <Text style={styles.heroLabel}>Stableford Points</Text>
            </View>
            {stablefordPresetSummary ? <Text style={styles.noStatsText}>{stablefordPresetSummary}</Text> : null}
            {round.tournamentStablefordMode === 'net' && round.tournamentStablefordHandicapStatus === 'ready' ? (
              <Text style={styles.noStatsText}>
                Net Stableford is using your player handicap {formatHandicapNumber(round.tournamentPlayerHandicap) ?? '-'} and course handicap {formatHandicapNumber(round.tournamentCourseHandicap) ?? '-'} from the selected tee and rating.
              </Text>
            ) : null}
            {round.tournamentStablefordMode === 'net' && round.tournamentStablefordHandicapStatus === 'fallback_gross_pending_handicap' ? (
              <Text style={styles.noStatsText}>
                {round.tournamentStablefordHandicapSource === 'missing_profile'
                  ? 'Net Stableford needs your player handicap on file. This round is using gross hole results until your handicap is added.'
                  : round.tournamentStablefordHandicapSource === 'missing_rating'
                    ? 'Net Stableford needs a valid tee and rating pairing to calculate course handicap. This round is using gross hole results for now.'
                    : round.tournamentStablefordHandicapSource === 'disabled'
                      ? 'This event is marked as Net Stableford, but handicap scoring is not enabled in the tournament setup yet.'
                      : 'Net Stableford handicap data is incomplete, so this round is using gross hole results for now.'}
              </Text>
            ) : null}
          </SectionCard>
        ) : null}

        <View style={styles.actions}>
          <AppButton
            title={saving ? 'Saving...' : (isIronman ? 'Finish Ironman Round' : isScramble ? 'Finish Scramble Round' : 'Finish Round')}
            onPress={handleSave}
            disabled={saving}
            style={{ flex: 1 }}
          />
          <AppButton title="Discard draft" onPress={handleDiscard} variant="secondary" disabled={saving} style={{ flex: 1 }} />
        </View>
        {saving && getRegularRoundBackendGameType(round) ? (
          <View style={styles.deleteRoundRow}>
            <AppButton
              title="Cancel Backend Sync"
              onPress={handleCancelFinalSync}
              variant="secondary"
              style={{ flex: 1 }}
            />
          </View>
        ) : null}

        {round.roundMode !== 'tournament' ? (
          <View style={styles.deleteRoundRow}>
            <AppButton
              title="Delete Current Round"
              onPress={handleDeleteCurrentRound}
              variant="secondary"
              disabled={saving}
              style={{ flex: 1 }}
            />
          </View>
        ) : null}

        <SectionCard>
          <Text style={styles.sectionTitle}>Hole-by-hole recap</Text>
          <View style={styles.recapList}>
            {round.holes.map((hole) => (
              <View key={hole.hole} style={styles.recapRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.recapHole}>Hole {hole.hole}</Text>
                  {bbbRound ? (
                    <>
                      {ensureGroupScoresForHole(hole, round.group?.participants ?? []).map((entry) => {
                        const participant = round.group?.participants?.find((item) => item.id === entry.participantId);
                        return (
                          <Text key={`recap-score-${hole.hole}-${entry.participantId}`} style={styles.recapMeta}>
                            {participant?.displayName ?? 'Player'}: {entry.score ?? '-'}
                          </Text>
                        );
                      })}
                      <Text style={styles.recapMeta}>Bingo: {bbbWinnerLabel(round.group?.participants ?? [], hole.bingoWinnerId)}</Text>
                      <Text style={styles.recapMeta}>Bango: {bbbWinnerLabel(round.group?.participants ?? [], hole.bangoWinnerId)}</Text>
                      <Text style={styles.recapMeta}>Bongo: {bbbWinnerLabel(round.group?.participants ?? [], hole.bongoWinnerId)}</Text>
                    </>
                  ) : skinsRound ? (
                    <>
                      {ensureGroupScoresForHole(hole, round.group?.participants ?? []).map((entry) => {
                        const participant = round.group?.participants?.find((item) => item.id === entry.participantId);
                        return (
                          <Text key={`recap-skins-score-${hole.hole}-${entry.participantId}`} style={styles.recapMeta}>
                            {participant?.displayName ?? 'Player'}: {entry.score ?? '-'}
                          </Text>
                        );
                      })}
                      <Text style={styles.recapMeta}>Result: {hole.skinsIsPush ? 'Push' : hole.skinsWinnerId ? (round.group?.participants?.find((item) => item.id === hole.skinsWinnerId)?.displayName ?? 'Winner set') : 'Pending'}</Text>
                      <Text style={styles.recapMeta}>Winning score: {hole.skinsWinningScore ?? '-'}</Text>
                      <Text style={styles.recapMeta}>Carryover in play: {hole.skinsCarryoverCount ?? '-'}</Text>
                      <Text style={styles.recapMeta}>Skins awarded: {hole.skinsAwardedCount ?? 0}</Text>
                    </>
                  ) : round.roundMode === 'casual_group' && round.group?.participants?.length ? (
                    <>
                      {ensureGroupScoresForHole(hole, round.group.participants).map((entry) => {
                        const participant = round.group?.participants.find((item) => item.id === entry.participantId);
                        return (
                          <Text key={`recap-standard-score-${hole.hole}-${entry.participantId}`} style={styles.recapMeta}>
                            {participant?.displayName ?? 'Player'}: {entry.score ?? '-'}
                          </Text>
                        );
                      })}
                      {statsEnabled ? <Text style={styles.recapMeta}>Putts {hole.totalPutts ?? '-'}</Text> : null}
                    </>
                  ) : (
                    <Text style={styles.recapMeta}>
                      {scoreLabel} {hole.score ?? '-'}
                      {isIronman ? ` · ${round.tournamentOpponentTeamName ?? 'Opponent'} ${hole.opponentScore ?? '-'}` : ''}
                      {isCrossCardDualScore ? ` · ${round.tournamentCrossCardTargetName ?? 'Cross-Card'} ${hole.opponentScore ?? '-'}` : ''}
                      {stablefordRound ? ` · Points ${hole.stablefordPoints ?? '-'}` : ''}
                      {statsEnabled ? ` · Putts ${hole.totalPutts ?? '-'}` : ''}
                    </Text>
                  )}
                </View>
                <AppButton
                  title="Edit"
                  onPress={() => void openHoleEditor(hole.hole)}
                  variant="secondary"
                  style={styles.editButton}
                />
              </View>
            ))}
          </View>
        </SectionCard>
      </ScrollView>
      <PlayerBottomNav />
    </BrandWatermarkBackground>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 16, gap: 16, paddingBottom: 112 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '800', color: '#132117' },
  subtitle: { fontSize: 15, color: '#5a6b61', lineHeight: 22 },
  contextText: { fontSize: 13, color: '#18341d', lineHeight: 18, fontWeight: '700' },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: '#132117', marginBottom: 8 },
  heroScoreWrap: { alignItems: 'center', marginBottom: 16 },
  heroScore: { fontSize: 56, fontWeight: '800', color: '#132117' },
  heroLabel: { fontSize: 14, color: '#5a6b61', textTransform: 'uppercase', fontWeight: '800', letterSpacing: 1.1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  box: { width: '30%', minWidth: 90, backgroundColor: '#eef3ec', borderRadius: 14, padding: 12, alignItems: 'center' },
  value: { fontSize: 24, fontWeight: '800', color: '#132117' },
  label: { fontSize: 12, color: '#5a6b61', textAlign: 'center' },
  noStatsText: { fontSize: 15, color: '#425247', lineHeight: 22 },
  recapList: { gap: 10, marginTop: 8 },
  recapRow: { backgroundColor: '#f8f5ee', borderRadius: 16, padding: 12, flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  recapHole: { fontSize: 16, fontWeight: '800', color: '#132117' },
  recapMeta: { fontSize: 13, color: '#5a6b61', marginTop: 4 },
  editButton: { minWidth: 72 },
  actions: { flexDirection: 'row', gap: 12 },
  deleteRoundRow: { marginTop: -4 },
  bbbLeaderGrid: { gap: 10 },
  bbbLeaderCard: { backgroundColor: '#eef3ec', borderRadius: 16, padding: 12, gap: 4 },
  puttOffCard: { backgroundColor: '#eef3ec', borderRadius: 16, padding: 12, gap: 12, marginTop: 12 },
  puttOffGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  puttOffButton: { flexGrow: 1 },
  bbbLeaderName: { fontSize: 16, fontWeight: '800', color: '#132117' },
  bbbLeaderPoints: { fontSize: 24, fontWeight: '800', color: '#132117' },
  bbbLeaderMeta: { fontSize: 13, color: '#5a6b61' },
});
