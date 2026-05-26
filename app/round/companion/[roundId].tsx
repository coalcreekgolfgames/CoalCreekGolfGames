import React, { useCallback, useState } from 'react';
import { Alert, AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { router, useLocalSearchParams } from 'expo-router';
import { TournamentQuickNav } from '@/components/navigation/TournamentQuickNav';
import { AppButton } from '@/components/ui/AppButton';
import { SectionCard } from '@/components/ui/SectionCard';
import {
  getGroupRoundCompanionAccess,
  getCurrentSupabaseSessionUserId,
  getGroupRoundCompanionGameType,
  getGroupRoundLiveProgress,
  isBackendLiveRoundActive,
  mergeGroupRoundLiveProgressIntoAccess,
  type GroupRoundCompanionGameType,
  type GroupRoundParticipantCompanionAccess,
  upsertGroupRoundCompanionMode,
} from '@/lib/groupRoundCompanions';
import { useAuth } from '@/providers/AuthProvider';

function liveBoardRoute(gameType: GroupRoundCompanionGameType, roundId: string) {
  if (gameType === 'bingo_bango_bongo') return `/round/bbb-live?roundId=${roundId}` as any;
  if (gameType === 'skins') return `/round/skins-live?roundId=${roundId}` as any;
  if (gameType === 'nassau') return `/round/nassau-live?roundId=${roundId}` as any;
  if (gameType === 'wolf') return `/round/wolf-live?roundId=${roundId}` as any;
  return `/round/live?roundId=${roundId}` as any;
}

export default function GroupRoundCompanionChooserScreen() {
  const params = useLocalSearchParams<{ roundId: string }>();
  const roundId = String(params.roundId ?? '');
  const { user, authRefreshKey } = useAuth();
  const isFocused = useIsFocused();
  const [access, setAccess] = useState<GroupRoundParticipantCompanionAccess | null>(null);
  const [gameType, setGameType] = useState<GroupRoundCompanionGameType>('standard');
  const [wantsScoreEntry, setWantsScoreEntry] = useState(false);
  const [wantsStatsEntry, setWantsStatsEntry] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const liveBoardRoundId = access?.round_id ?? roundId;

  const logCompanionDebug = (event: string, payload: Record<string, unknown>) => {
    if (!__DEV__) return;
    console.debug(`[companion-chooser] ${event}`, payload);
  };

  const loadCompanionChooser = useCallback(async (mountedRef?: { current: boolean }) => {
    const isMounted = () => mountedRef?.current !== false;
    if (!roundId || !user?.id) {
      if (!isMounted()) return;
      logCompanionDebug('skip_load', {
        roundId,
        userId: user?.id ?? null,
      });
      setAccess(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const sessionUserId = await getCurrentSupabaseSessionUserId();
      if (!isMounted()) return;
      if (!sessionUserId || sessionUserId !== user.id) {
        logCompanionDebug('session_mismatch', {
          roundId,
          requestedUserId: user.id,
          sessionUserId,
        });
        setAccess(null);
        setLoading(true);
        return;
      }

      const [nextAccess, nextGameType, nextLiveProgress] = await Promise.all([
        getGroupRoundCompanionAccess(roundId, user.id),
        getGroupRoundCompanionGameType(roundId),
        getGroupRoundLiveProgress(roundId),
      ]);
      if (!isMounted()) return;
      const mergedAccess = mergeGroupRoundLiveProgressIntoAccess(nextAccess, nextLiveProgress);
      const activeCheck = isBackendLiveRoundActive({
        source: 'backend_companion_access',
        roundId,
        status: mergedAccess?.status ?? nextLiveProgress?.status ?? null,
        liveProgressUpdatedAt: mergedAccess?.live_progress_updated_at ?? nextLiveProgress?.updated_at ?? null,
        completedOfficialHole: mergedAccess?.official_completed_hole ?? nextLiveProgress?.completed_official_hole ?? null,
        currentOfficialHole: mergedAccess?.official_current_hole ?? nextLiveProgress?.current_official_hole ?? null,
        hasAccessRow: !!mergedAccess,
        isScorer: mergedAccess?.is_scorer ?? null,
      });
      if (!activeCheck.active) {
        setAccess(null);
        setError('This round looks inactive.');
        setWantsScoreEntry(false);
        setWantsStatsEntry(false);
        logCompanionDebug('inactive_round_hidden', {
          roundId,
          hiddenReason: activeCheck.hiddenReason,
        });
        return;
      }
      setAccess(mergedAccess);
      setGameType(nextGameType);
      logCompanionDebug('loaded', {
        roundId,
        requestedUserId: user.id,
        sessionUserId,
        hasAccessRow: !!mergedAccess,
        accessUserId: mergedAccess?.user_id ?? null,
        accessIsScorer: mergedAccess?.is_scorer ?? null,
        officialCurrentHole: mergedAccess?.official_current_hole ?? null,
        officialCompletedHole: mergedAccess?.official_completed_hole ?? null,
        liveProgressUpdatedAt: mergedAccess?.live_progress_updated_at ?? null,
        gameType: nextGameType,
      });
      setWantsScoreEntry(mergedAccess?.wants_score_entry === true);
      setWantsStatsEntry(mergedAccess?.wants_stats_entry === true);
    } catch (nextError: any) {
      if (!isMounted()) return;
      logCompanionDebug('load_error', {
        roundId,
        requestedUserId: user?.id ?? null,
        message: nextError?.message ?? 'Could not load this group round.',
      });
      setError(nextError?.message ?? 'Could not load this group round.');
    } finally {
      if (isMounted()) setLoading(false);
    }
  }, [roundId, user?.id]);

  useFocusEffect(useCallback(() => {
    const mountedRef = { current: true };

    void loadCompanionChooser(mountedRef);

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && mountedRef.current) {
        void loadCompanionChooser(mountedRef);
      }
    });

    return () => {
      mountedRef.current = false;
      subscription.remove();
    };
  }, [loadCompanionChooser]));

  React.useEffect(() => {
    if (!isFocused) return;
    void loadCompanionChooser();
  }, [authRefreshKey, isFocused, loadCompanionChooser]);

  const handleSave = async () => {
    if (!access || !user?.id) return;

    setSaving(true);
    try {
      const companion = await upsertGroupRoundCompanionMode({
        roundId,
        roundParticipantId: access.round_participant_id,
        userId: user.id,
        wantsScoreEntry,
        wantsStatsEntry,
      });

        if (wantsScoreEntry || wantsStatsEntry) {
          router.replace(`/round/companion-entry/${roundId}?companionId=${companion.id}` as any);
        } else {
          router.replace(liveBoardRoute(gameType, liveBoardRoundId));
        }
    } catch (nextError: any) {
      Alert.alert('Could not save choice', nextError?.message ?? 'Try again when the backend is reachable.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Join Group Round</Text>
        <Text style={styles.subtitle}>Choose how you want to participate. Official scorekeeper scoring remains separate.</Text>

        {loading ? (
          <SectionCard>
            <Text style={styles.body}>Loading group round access...</Text>
          </SectionCard>
        ) : error ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>Group round unavailable</Text>
            <Text style={styles.body}>{error}</Text>
          </SectionCard>
        ) : !user ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>Sign in required</Text>
            <Text style={styles.body}>Sign in as a registered participant to join this group round.</Text>
          </SectionCard>
        ) : !access ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>Not a registered participant</Text>
            <Text style={styles.body}>Only app users already seated in this group round can use participant companion mode.</Text>
          </SectionCard>
        ) : access.is_scorer ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>You are the scorekeeper</Text>
            <Text style={styles.body}>Use the official round flow on the scorekeeper device. Companion mode is for other registered players.</Text>
            <AppButton title="Open Live Board" onPress={() => router.replace(liveBoardRoute(gameType, liveBoardRoundId))} variant="secondary" />
          </SectionCard>
        ) : (
          <>
            <SectionCard>
              <Text style={styles.sectionTitle}>{access.display_name}</Text>
              <Text style={styles.body}>
                {gameType === 'bingo_bango_bongo'
                  ? 'Bingo Bango Bongo group round'
                  : gameType === 'skins'
                    ? 'Skins group round'
                    : 'Standard group round'}
              </Text>
              <Text style={styles.body}>Watch-only is the default. Score and stats entries are saved to your participant record only.</Text>
            </SectionCard>

            <SectionCard>
              <Text style={styles.sectionTitle}>Participation Mode</Text>
              <View style={styles.optionList}>
                <AppButton
                  title={wantsScoreEntry ? 'Entering My Score' : 'Enter My Score'}
                  onPress={() => setWantsScoreEntry((current) => !current)}
                  variant={wantsScoreEntry ? 'primary' : 'secondary'}
                />
                <AppButton
                  title={wantsStatsEntry ? 'Keeping My Stats' : 'Keep My Stats'}
                  onPress={() => setWantsStatsEntry((current) => !current)}
                  variant={wantsStatsEntry ? 'primary' : 'secondary'}
                />
                <AppButton
                  title={!wantsScoreEntry && !wantsStatsEntry ? 'Watch Live Board Only' : 'Clear to Watch Only'}
                  onPress={() => {
                    setWantsScoreEntry(false);
                    setWantsStatsEntry(false);
                  }}
                  variant={!wantsScoreEntry && !wantsStatsEntry ? 'primary' : 'secondary'}
                />
              </View>
            </SectionCard>

            <AppButton title={saving ? 'Saving...' : 'Continue'} onPress={handleSave} disabled={saving} />
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
  optionList: { gap: 10 },
});
