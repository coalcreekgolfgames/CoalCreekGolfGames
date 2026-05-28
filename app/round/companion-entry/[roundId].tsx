import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { router, useLocalSearchParams } from 'expo-router';
import { TournamentQuickNav } from '@/components/navigation/TournamentQuickNav';
import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { SectionCard } from '@/components/ui/SectionCard';
import { holes as courseHoles, teeDisplayLabel, yardageForHoleAndTee } from '@/constants/course';
import { getGroupRoundCompanionEntryProgress, type GroupRoundCompanionEntryProgress } from '@/lib/groupRoundCompanionProgress';
import {
  getGroupRoundCompanionAccess,
  getCurrentSupabaseSessionUserId,
  getGroupRoundLiveProgress,
  getGroupRoundCompanionScores,
  getGroupRoundCompanionStats,
  mergeGroupRoundLiveProgressIntoAccess,
  type GroupRoundCompanionCrossCardScore,
  type GroupRoundCompanionHoleStats,
  type GroupRoundParticipantCompanionAccess,
  upsertGroupRoundCompanionScore,
  upsertGroupRoundCompanionStats,
} from '@/lib/groupRoundCompanions';
import { useAuth } from '@/providers/AuthProvider';

const HOLES = Array.from({ length: 18 }, (_, index) => index + 1);
const SCORE_OPTIONS = Array.from({ length: 12 }, (_, index) => index + 1);

function numberOrNull(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function GroupRoundCompanionEntryScreen() {
  const params = useLocalSearchParams<{ roundId: string; companionId?: string }>();
  const roundId = String(params.roundId ?? '');
  const { user, authRefreshKey } = useAuth();
  const isFocused = useIsFocused();
  const [access, setAccess] = useState<GroupRoundParticipantCompanionAccess | null>(null);
  const [scores, setScores] = useState<GroupRoundCompanionCrossCardScore[]>([]);
  const [stats, setStats] = useState<GroupRoundCompanionHoleStats[]>([]);
  const [holeNumber, setHoleNumber] = useState(1);
  const [scoreValue, setScoreValue] = useState<number | null>(null);
  const [puttsValue, setPuttsValue] = useState<number | null>(null);
  const [penaltiesText, setPenaltiesText] = useState('');
  const [fairwayHit, setFairwayHit] = useState<boolean | null>(null);
  const [greenInRegulation, setGreenInRegulation] = useState<boolean | null>(null);
  const [upAndDownAttempted, setUpAndDownAttempted] = useState<boolean | null>(null);
  const [upAndDownSuccess, setUpAndDownSuccess] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<GroupRoundCompanionEntryProgress | null>(null);
  const holeNumberRef = useRef(holeNumber);
  const courseHole = courseHoles[holeNumber - 1];
  const selectedTeeLabel = access?.selected_tee ? teeDisplayLabel(access.selected_tee) : 'Tee not selected';
  const selectedHoleYardage = access?.selected_tee && courseHole ? yardageForHoleAndTee(courseHole, access.selected_tee) : null;

  const logCompanionEntryDebug = (event: string, payload: Record<string, unknown>) => {
    if (!__DEV__) return;
    console.debug(`[companion-entry] ${event}`, payload);
  };

  const resolveNextHoleNumber = useCallback((nextProgress: GroupRoundCompanionEntryProgress, currentHole?: number | null) => {
    if (nextProgress.pendingHoleNumber != null && currentHole === nextProgress.pendingHoleNumber) {
      return currentHole;
    }

    if (nextProgress.nextHoleNumber != null) {
      return nextProgress.nextHoleNumber;
    }

    if (currentHole && nextProgress.allowedHoleNumbers.includes(currentHole)) {
      return currentHole;
    }

    return nextProgress.pendingHoleNumber ?? Math.max(1, nextProgress.officialCurrentHole || 1);
  }, []);

  const loadCompanionEntry = useCallback(async (options?: {
    mountedRef?: { current: boolean };
    preserveHoleNumber?: number | null;
  }) => {
    const isMounted = () => options?.mountedRef?.current !== false;
    if (!roundId || !user?.id) {
      if (!isMounted()) return;
      logCompanionEntryDebug('skip_load', {
        roundId,
        userId: user?.id ?? null,
      });
      setAccess(null);
      setScores([]);
      setStats([]);
      setProgress(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const sessionUserId = await getCurrentSupabaseSessionUserId();
      if (!isMounted()) return;
      if (!sessionUserId || sessionUserId !== user.id) {
        logCompanionEntryDebug('session_mismatch', {
          roundId,
          requestedUserId: user.id,
          sessionUserId,
        });
        setAccess(null);
        setScores([]);
        setStats([]);
        setProgress(null);
        setLoading(true);
        return;
      }

      const [nextAccess, nextLiveProgress, nextScores, nextStats] = await Promise.all([
        getGroupRoundCompanionAccess(roundId, user.id),
        getGroupRoundLiveProgress(roundId),
        getGroupRoundCompanionScores(roundId, user.id),
        getGroupRoundCompanionStats(roundId, user.id),
      ]);
      if (!isMounted()) return;
      const mergedAccess = mergeGroupRoundLiveProgressIntoAccess(nextAccess, nextLiveProgress);
      setAccess(mergedAccess);
      setScores(nextScores);
      setStats(nextStats);
      logCompanionEntryDebug('loaded', {
        roundId,
        requestedUserId: user.id,
        sessionUserId,
        hasAccessRow: !!mergedAccess,
        accessUserId: mergedAccess?.user_id ?? null,
        accessIsScorer: mergedAccess?.is_scorer ?? null,
        officialCurrentHole: mergedAccess?.official_current_hole ?? null,
        officialCompletedHole: mergedAccess?.official_completed_hole ?? null,
        liveProgressUpdatedAt: mergedAccess?.live_progress_updated_at ?? null,
        scoreCount: nextScores.length,
        statsCount: nextStats.length,
      });
      if (mergedAccess) {
        const nextProgress = await getGroupRoundCompanionEntryProgress({
          roundId,
          access: mergedAccess,
          scores: nextScores,
          stats: nextStats,
        });
        if (!isMounted()) return;
        setProgress(nextProgress);
        logCompanionEntryDebug('progress', {
          roundId,
          requestedUserId: user.id,
          officialCompletedHole: nextProgress.officialCompletedHole,
          officialCurrentHole: nextProgress.officialCurrentHole,
          nextHoleNumber: nextProgress.nextHoleNumber ?? null,
          pendingHoleNumber: nextProgress.pendingHoleNumber ?? null,
          allowedHoleCount: nextProgress.allowedHoleNumbers.length,
        });
        setHoleNumber(resolveNextHoleNumber(nextProgress, options?.preserveHoleNumber ?? null));
      } else {
        setProgress(null);
      }
    } catch (error: any) {
      logCompanionEntryDebug('load_error', {
        roundId,
        requestedUserId: user?.id ?? null,
        message: error?.message ?? 'Try again when the backend is reachable.',
      });
      Alert.alert('Could not load companion entry', error?.message ?? 'Try again when the backend is reachable.');
    } finally {
      if (isMounted()) setLoading(false);
    }
  }, [resolveNextHoleNumber, roundId, user?.id]);

  useFocusEffect(useCallback(() => {
    const mountedRef = { current: true };

    void loadCompanionEntry({ mountedRef });

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && mountedRef.current) {
        void loadCompanionEntry({ mountedRef, preserveHoleNumber: holeNumberRef.current });
      }
    });

    return () => {
      mountedRef.current = false;
      subscription.remove();
    };
  }, [loadCompanionEntry]));

  useEffect(() => {
    if (!isFocused) return;
    void loadCompanionEntry({ preserveHoleNumber: holeNumberRef.current });
  }, [authRefreshKey, isFocused, loadCompanionEntry]);

  const existingScore = useMemo(
    () => scores.find((entry) => entry.hole_number === holeNumber) ?? null,
    [holeNumber, scores],
  );
  const existingStats = useMemo(
    () => stats.find((entry) => entry.hole_number === holeNumber) ?? null,
    [holeNumber, stats],
  );

  useEffect(() => {
    holeNumberRef.current = holeNumber;
  }, [holeNumber]);

  useEffect(() => {
    setScoreValue(existingScore?.strokes ?? null);
    setPuttsValue(existingStats?.putts ?? null);
    setPenaltiesText(existingStats?.penalties != null ? String(existingStats.penalties) : '');
    setFairwayHit(existingStats?.fairway_hit ?? null);
    setGreenInRegulation(existingStats?.green_in_regulation ?? null);
    setUpAndDownAttempted(existingStats?.up_and_down_attempted ?? null);
    setUpAndDownSuccess(existingStats?.up_and_down_success ?? null);
  }, [existingScore, existingStats]);

  const handleSaveHole = async () => {
    if (!access || !user?.id || !access.companion_id) return;

    if ((progress?.officialCurrentHole ?? 0) <= 0) {
      Alert.alert('Wait for the scorekeeper', 'Participant entry opens as soon as the official scorekeeper starts hole 1.');
      return;
    }

    if (holeNumber > (progress?.officialCurrentHole ?? 0)) {
      Alert.alert('Hole not available yet', `You can only enter holes through ${progress?.officialCurrentHole ?? 0} until the scorekeeper advances.`);
      return;
    }

    const strokes = scoreValue;
    const putts = puttsValue;
    const penalties = numberOrNull(penaltiesText);

    if (access.wants_score_entry && (!strokes || strokes <= 0)) {
      Alert.alert('Missing score', 'Enter a positive score for this hole.');
      return;
    }

    setSaving(true);
    try {
      if (access.wants_score_entry && strokes) {
        await upsertGroupRoundCompanionScore({
          companionId: access.companion_id,
          roundId,
          roundParticipantId: access.round_participant_id,
          userId: user.id,
          holeNumber,
          strokes,
        });
      }

      if (access.wants_stats_entry) {
        await upsertGroupRoundCompanionStats({
          companionId: access.companion_id,
          roundId,
          roundParticipantId: access.round_participant_id,
          userId: user.id,
          holeNumber,
          fairwayHit,
          greenInRegulation,
          putts,
          penalties,
          upAndDownAttempted,
          upAndDownSuccess,
        });
      }

      await loadCompanionEntry();
    } catch (error: any) {
      Alert.alert('Could not save hole', error?.message ?? 'Try again when the backend is reachable.');
    } finally {
      setSaving(false);
    }
  };

  const completedScoreCount = scores.length;
  const completedStatsCount = stats.length;
  const officialCompletedHole = progress?.officialCompletedHole ?? 0;
  const officialCurrentHole = progress?.officialCurrentHole ?? 0;
  const allowedHoleNumbers = progress?.allowedHoleNumbers ?? [];
  const holeSelectionEnabled = officialCurrentHole > 0 && allowedHoleNumbers.length > 0;
  const waitingForCurrentHoleCompletion = progress?.waitingForOfficialCompletion === true && progress?.pendingHoleNumber === holeNumber;

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>My Round Entry</Text>
        <Text style={styles.subtitle}>These entries are saved to your participant record and do not change the live official score.</Text>

        {loading ? (
          <SectionCard>
            <Text style={styles.body}>Loading participant entry...</Text>
          </SectionCard>
        ) : !user || !access ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>Companion entry unavailable</Text>
            <Text style={styles.body}>Open this from a group round where you are a registered non-scorekeeper participant.</Text>
          </SectionCard>
        ) : !access.companion_id || (!access.wants_score_entry && !access.wants_stats_entry) ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>Choose a mode first</Text>
            <Text style={styles.body}>Select score entry or stats entry before using the companion entry form.</Text>
            <AppButton title="Choose Mode" onPress={() => router.replace(`/round/companion/${roundId}` as any)} />
          </SectionCard>
        ) : !access.selected_tee ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>Choose your tee</Text>
            <Text style={styles.body}>Select your tee before entering scores or stats so hole yardages match your round.</Text>
            <AppButton title="Choose Tee" onPress={() => router.replace(`/round/companion/${roundId}` as any)} />
          </SectionCard>
        ) : (
          <>
            <SectionCard>
              <Text style={styles.sectionTitle}>{access.display_name}</Text>
              <Text style={styles.body}>
                {access.wants_score_entry ? `Scores saved: ${completedScoreCount}/18` : 'Score entry off'}
                {' / '}
                {access.wants_stats_entry ? `Stats saved: ${completedStatsCount}/18` : 'Stats entry off'}
              </Text>
              <Text style={styles.body}>
                {officialCurrentHole > 0
                  ? officialCurrentHole > officialCompletedHole
                    ? `Official scorekeeper is currently on hole ${officialCurrentHole}. Completed through hole ${officialCompletedHole}.`
                    : `Official scorekeeper has completed through hole ${officialCompletedHole}.`
                  : 'Waiting for the official scorekeeper to start hole 1.'}
              </Text>
            </SectionCard>

            <SectionCard>
              <Text style={styles.sectionTitle}>Hole {holeNumber}</Text>
              <Text style={styles.body}>
                {selectedTeeLabel}
                {selectedHoleYardage ? ` / ${selectedHoleYardage} yards` : ''}
              </Text>
              <Text style={styles.body}>
                {progress?.nextHoleNumber
                  ? `Defaulting to your earliest missing allowed hole: ${progress.nextHoleNumber}.`
                  : progress?.waitingForOfficialCompletion && progress.pendingHoleNumber
                    ? `Your entry for hole ${progress.pendingHoleNumber} is saved. Waiting for the scorekeeper to complete that hole before you can advance.`
                    : officialCurrentHole > 0
                      ? 'You have filled every hole currently available to you. Wait for the scorekeeper to advance, or review an already completed hole.'
                      : 'Participant entry unlocks as soon as the scorekeeper is on hole 1.'}
              </Text>
              <View style={styles.holeGrid}>
                {HOLES.map((hole) => (
                  <AppButton
                    key={`companion-hole-${hole}`}
                    title={`${hole}`}
                    onPress={() => setHoleNumber(hole)}
                    disabled={!allowedHoleNumbers.includes(hole)}
                    variant={hole === holeNumber ? 'primary' : 'secondary'}
                    style={styles.holeButton}
                  />
                ))}
              </View>
            </SectionCard>

            {access.wants_score_entry ? (
              <SectionCard>
                <Text style={styles.sectionTitle}>Cross-Card Score</Text>
                <Text style={styles.body}>
                  Current score: {typeof scoreValue === 'number' ? scoreValue : 'Not entered'}
                </Text>
                <View style={styles.holeGrid}>
                  {SCORE_OPTIONS.map((value) => (
                    <AppButton
                      key={`companion-score-${holeNumber}-${value}`}
                      title={`${value}`}
                      onPress={() => setScoreValue(value)}
                      variant={scoreValue === value ? 'primary' : 'secondary'}
                      style={styles.holeButton}
                    />
                  ))}
                </View>
                {existingScore?.official_strokes != null ? (
                  <Text style={styles.body}>
                    Official score currently {existingScore.official_strokes}
                    {existingScore.score_delta ? ` / delta ${existingScore.score_delta > 0 ? '+' : ''}${existingScore.score_delta}` : ''}
                  </Text>
                ) : null}
                {waitingForCurrentHoleCompletion ? (
                  <Text style={styles.body}>Saved for this hole. Waiting for the official scorekeeper to complete it before you can move on.</Text>
                ) : null}
              </SectionCard>
            ) : null}

            {access.wants_stats_entry ? (
              <SectionCard>
                <Text style={styles.sectionTitle}>My Stats</Text>
                <View style={styles.toggleGrid}>
                  <AppButton title={fairwayHit === true ? 'Fairway: Yes' : 'Fairway'} onPress={() => setFairwayHit(fairwayHit === true ? null : true)} variant={fairwayHit === true ? 'primary' : 'secondary'} style={styles.toggleButton} />
                  <AppButton title={greenInRegulation === true ? 'GIR: Yes' : 'GIR'} onPress={() => setGreenInRegulation(greenInRegulation === true ? null : true)} variant={greenInRegulation === true ? 'primary' : 'secondary'} style={styles.toggleButton} />
                  <AppButton title={upAndDownAttempted === true ? 'Up/Down Try' : 'Up/Down Attempt'} onPress={() => setUpAndDownAttempted(upAndDownAttempted === true ? null : true)} variant={upAndDownAttempted === true ? 'primary' : 'secondary'} style={styles.toggleButton} />
                  <AppButton title={upAndDownSuccess === true ? 'Up/Down Made' : 'Up/Down Made'} onPress={() => setUpAndDownSuccess(upAndDownSuccess === true ? null : true)} variant={upAndDownSuccess === true ? 'primary' : 'secondary'} style={styles.toggleButton} />
                </View>
                <Text style={styles.body}>
                  Putts: {typeof puttsValue === 'number' ? puttsValue : 'Not entered'}
                </Text>
                <View style={styles.puttsRow}>
                  {[1, 2, 3].map((value) => (
                    <AppButton
                      key={`companion-putts-${holeNumber}-${value}`}
                      title={`${value}`}
                      onPress={() => setPuttsValue(value)}
                      compact
                      variant={puttsValue === value ? 'primary' : 'secondary'}
                      style={styles.puttsButton}
                    />
                  ))}
                </View>
                <AppInput label="Penalties" value={penaltiesText} onChangeText={setPenaltiesText} keyboardType="number-pad" />
              </SectionCard>
            ) : null}

            {officialCurrentHole <= 0 || progress?.allAllowedHolesComplete ? (
              <SectionCard>
                <Text style={styles.emptyTitle}>Waiting for official progress</Text>
                <Text style={styles.body}>
                  {officialCurrentHole <= 0
                    ? 'The scorekeeper has not started hole 1 yet. You can begin entering your round as soon as hole 1 is active.'
                    : progress?.waitingForOfficialCompletion && progress.pendingHoleNumber
                      ? `You have already saved hole ${progress.pendingHoleNumber}. Check back after the scorekeeper completes it and advances.`
                      : `You have already filled every hole through ${officialCurrentHole}. Check back after the scorekeeper advances.`}
                </Text>
              </SectionCard>
            ) : null}

            <AppButton
              title={saving ? 'Saving...' : 'Save Hole'}
              onPress={handleSaveHole}
              disabled={saving || !holeSelectionEnabled || holeNumber > officialCurrentHole}
            />
            <AppButton title="Change Mode" onPress={() => router.push(`/round/companion/${roundId}` as any)} variant="secondary" />
          </>
        )}

        <AppButton title="Back" onPress={() => router.back()} variant="secondary" />
      </ScrollView>
      <TournamentQuickNav />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f0e7' },
  container: { flex: 1, backgroundColor: '#f4f0e7' },
  content: { padding: 16, gap: 16, paddingBottom: 112 },
  title: { fontSize: 28, fontWeight: '800', color: '#132117' },
  subtitle: { fontSize: 15, color: '#5a6b61', lineHeight: 22 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: '#132117', marginBottom: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#132117', marginBottom: 8 },
  body: { fontSize: 14, color: '#5a6b61', lineHeight: 21 },
  holeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  holeButton: { width: 52, minHeight: 44, paddingHorizontal: 0 },
  toggleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  toggleButton: { flexGrow: 1 },
  puttsRow: { flexDirection: 'row', gap: 12, marginTop: 8, marginBottom: 12 },
  puttsButton: { flex: 1, minWidth: 0 },
});
