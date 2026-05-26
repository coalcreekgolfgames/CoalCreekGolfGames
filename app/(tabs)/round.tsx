import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { BrandedScreen } from '@/components/BrandedScreen';
import { AppButton } from '@/components/ui/AppButton';
import { SectionCard } from '@/components/ui/SectionCard';
import { getGroupRoundPrimaryEntryDecision } from '@/lib/groupRoundEntry';
import { getCurrentUserActiveGroupRound, getGroupRoundCompanionGameType, type ActiveGroupRoundSummary, type GroupRoundCompanionGameType } from '@/lib/groupRoundCompanions';
import {
  deleteCurrentRound,
  deleteLiveSoloRound,
  getDeleteCurrentRoundButtonLabel,
  getDeleteCurrentRoundConfirmLabel,
  getDeleteCurrentRoundMessage,
  getDeleteCurrentRoundTitle,
  isLiveSoloRound,
} from '@/lib/currentRound';
import { summarizeBingoBangoBongo } from '@/lib/bingoBangoBongo';
import { formatCurrencyFromCents } from '@/lib/currency';
import { summarizeSkins } from '@/lib/skins';
import { getCompletedHoleCount, getSavedHoleNumbers, loadLiveRoundVisibilityState } from '@/lib/localRound';
import {
  drainActiveRegularRoundSync,
  getRegularRoundBackendGameType,
  getRegularRoundBackendStatusDetail,
  shouldRetryRegularRoundSyncNow,
} from '@/lib/regularRoundBackendSync';
import { isStandardLiveBoardRound } from '@/lib/standardRoundLiveBoard';
import { useAuth } from '@/providers/AuthProvider';
import type { LocalRoundDraft } from '@/types/round';

function backendGroupLiveBoardRoute(gameType: GroupRoundCompanionGameType, roundId: string) {
  if (gameType === 'bingo_bango_bongo') return `/round/bbb-live?roundId=${roundId}` as any;
  if (gameType === 'skins') return `/round/skins-live?roundId=${roundId}` as any;
  if (gameType === 'nassau') return `/round/nassau-live?roundId=${roundId}` as any;
  if (gameType === 'wolf') return `/round/wolf-live?roundId=${roundId}` as any;
  return `/round/live?roundId=${roundId}` as any;
}

export default function RoundTabScreen() {
  const { user, loading: authLoading, authRefreshKey } = useAuth();
  const [draft, setDraft] = useState<LocalRoundDraft | null>(null);
  const [activeParticipantRound, setActiveParticipantRound] = useState<ActiveGroupRoundSummary | null>(null);
  const [activeParticipantRoundGameType, setActiveParticipantRoundGameType] = useState<GroupRoundCompanionGameType>('standard');
  const [staleDraft, setStaleDraft] = useState<LocalRoundDraft | null>(null);
  const [entryTitle, setEntryTitle] = useState('Continue Hole');
  const [entryLoading, setEntryLoading] = useState(false);
  const [syncStatusMessage, setSyncStatusMessage] = useState<string | null>(null);

  useFocusEffect(React.useCallback(() => {
    let active = true;

    const load = async () => {
      try {
        const visibilityState = await loadLiveRoundVisibilityState();
        const nextDraft = visibilityState.activeRound;
        if (!active) return;
        setEntryLoading(nextDraft?.roundMode === 'casual_group' && !!nextDraft.backendRoundId);
        setDraft(nextDraft);
        setStaleDraft(visibilityState.staleRound);
        setActiveParticipantRound(null);
        setSyncStatusMessage(nextDraft ? getRegularRoundBackendStatusDetail(nextDraft) : null);

        if (nextDraft && user?.id && getRegularRoundBackendGameType(nextDraft) && shouldRetryRegularRoundSyncNow(nextDraft)) {
          void drainActiveRegularRoundSync({
            userId: user.id,
            trigger: 'round_tab_focus',
            onUpdate: (updatedRound) => {
              if (!active) return;
              setDraft(updatedRound);
              setSyncStatusMessage(getRegularRoundBackendStatusDetail(updatedRound));
            },
          }).catch(() => {});
        }

        const decision = await getGroupRoundPrimaryEntryDecision({
          round: nextDraft,
          userId: user?.id,
          authLoading,
        });
        if (!active) return;

        setEntryTitle(decision.label);
        setEntryLoading(decision.status === 'loading');

        if (decision.status === 'companion' && decision.route) {
          router.replace(decision.route as any);
          return;
        }

        if (!nextDraft && user?.id) {
          const backendRound = await getCurrentUserActiveGroupRound(user.id);
          if (!active) return;
          setActiveParticipantRound(backendRound);
          if (backendRound?.roundId) {
            const gameType = await getGroupRoundCompanionGameType(backendRound.roundId);
            if (!active) return;
            setActiveParticipantRoundGameType(gameType);
          }
        }
      } catch (error) {
        console.error('round tab load failed', error);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [authLoading, authRefreshKey, user?.id]));

  if (!draft) {
    return (
      <BrandedScreen
        screenName="RoundTabScreen-empty"
        title="Live Round"
        subtitle="Start a round or jump back into an active scorekeeping session."
        scroll={false}
      >
        <View style={styles.empty}>
          {staleDraft && staleDraft.roundMode === 'solo' ? (
            <SectionCard>
              <Text style={styles.title}>Unfinished Solo Round</Text>
              <Text style={styles.subtitle}>{staleDraft.date} | {staleDraft.tee} | {staleDraft.ratingType}</Text>
              <Text style={styles.groupMeta}>
                Saved holes: {getSavedHoleNumbers(staleDraft).join(', ') || 'none'} | Completed: {getCompletedHoleCount(staleDraft)}
              </Text>
              <View style={styles.stack}>
                <AppButton
                  title="Delete Live Solo Round"
                  variant="secondary"
                  onPress={() => {
                    Alert.alert(
                      'Delete this unfinished solo round?',
                      'This will remove the stale solo draft from this device and try to remove any backend draft too.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete Solo Round',
                          style: 'destructive',
                          onPress: async () => {
                            const result = await deleteLiveSoloRound(staleDraft);
                            if (result.backendCleanupError) {
                              Alert.alert('Delete failed', 'The live solo round could not be fully removed yet. Please try again.');
                              return;
                            }
                            setStaleDraft(null);
                          },
                        },
                      ],
                    );
                  }}
                />
              </View>
            </SectionCard>
          ) : null}
          {activeParticipantRound ? (
            <SectionCard>
              <Text style={styles.title}>Active Group Round</Text>
              <Text style={styles.subtitle}>
                {activeParticipantRound.roundDate ?? 'Today'} | {activeParticipantRound.courseName ?? 'Coal Creek'}
              </Text>
              <Text style={styles.groupMeta}>
                {activeParticipantRound.displayName} | Hole {activeParticipantRound.officialCurrentHole ?? Math.max((activeParticipantRound.officialCompletedHole ?? 0) + 1, 1)}
              </Text>
              <View style={styles.stack}>
                <AppButton title="Join Live Round" onPress={() => router.push(`/round/companion/${activeParticipantRound.roundId}` as any)} />
                <AppButton title="Watch Live Board" onPress={() => router.push(backendGroupLiveBoardRoute(activeParticipantRoundGameType, activeParticipantRound.roundId))} variant="secondary" />
              </View>
            </SectionCard>
          ) : (
            <View style={styles.blankState}>
              <Text style={styles.title}>No active live round.</Text>
            </View>
          )}
        </View>
      </BrandedScreen>
    );
  }

  const isGroup = draft.roundMode === 'casual_group';
  const bbbSummary = draft.groupGameMode === 'bingo_bango_bongo' ? summarizeBingoBangoBongo(draft) : null;
  const skinsSummary = draft.groupGameMode === 'skins' ? summarizeSkins(draft) : null;

  const openRoundEntry = async (targetHole: number) => {
    const decision = await getGroupRoundPrimaryEntryDecision({
      round: draft,
      userId: user?.id,
      authLoading,
    });

    if (decision.status === 'companion' && decision.route) {
      router.push(decision.route as any);
      return;
    }

    if (decision.status !== 'official') {
      Alert.alert('Round unavailable', decision.message ?? 'This shared group round is not available for official scoring.');
      return;
    }

    router.push(`/round/hole/${targetHole}` as any);
  };

  const openReviewEntry = async () => {
    const decision = await getGroupRoundPrimaryEntryDecision({
      round: draft,
      userId: user?.id,
      authLoading,
    });

    if (decision.status === 'companion' && decision.route) {
      router.push(decision.route as any);
      return;
    }

    if (decision.status !== 'official') {
      Alert.alert('Round unavailable', decision.message ?? 'This shared group round is not available for official scoring.');
      return;
    }

    router.push('/round/review');
  };

  const handleDeleteCurrentRound = () => {
    if (!draft || draft.roundMode === 'tournament') return;

    Alert.alert(
      getDeleteCurrentRoundTitle(draft),
      getDeleteCurrentRoundMessage(draft),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: getDeleteCurrentRoundConfirmLabel(draft),
          style: 'destructive',
          onPress: async () => {
            const result = isLiveSoloRound(draft)
              ? await deleteLiveSoloRound(draft)
              : await deleteCurrentRound(draft);

            if (result.backendCleanupError) {
              Alert.alert(
                'Delete failed',
                isLiveSoloRound(draft)
                  ? 'The live solo round could not be removed from the backend yet. It is still on this device so you can retry.'
                  : 'The current round could not be fully removed yet. Please try again.',
              );
              return;
            }

            setDraft(null);
            setEntryLoading(false);
            setEntryTitle('Continue Hole');
            router.replace('/(tabs)/home');
          },
        },
      ],
    );
  };

  return (
    <BrandedScreen
      screenName="RoundTabScreen"
      title="Live Round"
      subtitle="Round controls, live-game links, and in-progress round actions."
      scroll={false}
      bodyStyle={styles.bodyWrap}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <SectionCard>
        <Text style={styles.title}>{isGroup ? 'Live Group Round' : 'Live Round'}</Text>
        <Text style={styles.subtitle}>{draft.date} | {draft.tee} | {draft.ratingType}</Text>
        {isGroup && draft.group ? (
          <View style={styles.groupCard}>
            <Text style={styles.groupName}>{draft.group.groupName}</Text>
            <Text style={styles.groupMeta}>
              {draft.group.participants.map((participant) => participant.displayName).join(' | ')}
            </Text>
            {draft.groupGameMode === 'bingo_bango_bongo' ? <Text style={styles.groupMeta}>Game: Bingo Bango Bongo</Text> : null}
            {draft.groupGameMode === 'skins' ? <Text style={styles.groupMeta}>Game: Skins</Text> : null}
            {draft.groupGameMode === 'nassau' ? <Text style={styles.groupMeta}>Game: Nassau</Text> : null}
            {draft.groupGameMode === 'wolf' ? <Text style={styles.groupMeta}>Game: Wolf</Text> : null}
            {draft.groupGameMode === 'bingo_bango_bongo' || draft.groupGameMode === 'skins' ? (
              <Text style={styles.groupMeta}>
                Buy-in {formatCurrencyFromCents(draft.roundGameBuyInCents ?? 0)} | Pot {formatCurrencyFromCents((draft.roundGameBuyInCents ?? 0) * draft.group.participants.length)}
              </Text>
            ) : null}
            {draft.groupGameMode === 'nassau' ? (
              <Text style={styles.groupMeta}>
                Buy-in {formatCurrencyFromCents(draft.roundGameBuyInCents ?? 0)} | Pot {formatCurrencyFromCents((draft.roundGameBuyInCents ?? 0) * ((draft.nassauParticipantIds?.length ?? 0) || draft.group.participants.length))}
              </Text>
            ) : null}
            {draft.groupGameMode === 'wolf' ? (
              <Text style={styles.groupMeta}>
                Buy-in {formatCurrencyFromCents(draft.roundGameBuyInCents ?? 0)} | Pot {formatCurrencyFromCents((draft.roundGameBuyInCents ?? 0) * ((draft.wolfParticipantIds?.length ?? 0) || draft.group.participants.length))}
              </Text>
            ) : null}
            <Text style={styles.groupMeta}>
              Scorekeeper: {draft.group.participants.find((participant) => participant.isScorekeeper)?.displayName ?? 'Not set'}
            </Text>
            {bbbSummary ? (
              <View style={styles.bbbWrap}>
                {bbbSummary.totals.map((row) => (
                  <View key={row.participantId} style={styles.bbbCard}>
                    <Text style={styles.bbbName}>{row.displayName}</Text>
                    <Text style={styles.bbbMeta}>{row.total} BBB pts</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {skinsSummary ? (
              <View style={styles.bbbWrap}>
                {skinsSummary.totals.map((row) => (
                  <View key={row.participantId} style={styles.bbbCard}>
                    <Text style={styles.bbbName}>{row.displayName}</Text>
                    <Text style={styles.bbbMeta}>{row.totalSkinCountWon} skins</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
        <View style={styles.row}>
          {!isGroup || !entryLoading ? (
            <AppButton title={isGroup ? `${entryTitle}${entryTitle === 'Continue Hole' ? ` ${draft.currentHole}` : ''}` : `Continue Hole ${draft.currentHole}`} onPress={() => void openRoundEntry(draft.currentHole)} style={styles.actionButton} />
          ) : (
            <View style={[styles.loadingButton, { flex: 1 }]}>
              <Text style={styles.loadingButtonText}>Checking round access...</Text>
            </View>
          )}
          <AppButton title="Review round" onPress={() => void openReviewEntry()} disabled={isGroup && entryLoading} variant="secondary" style={styles.actionButton} />
        </View>
        {isStandardLiveBoardRound(draft) ? (
          <View style={styles.row}>
            <AppButton title="Open Live Board" onPress={() => router.push('/round/live' as any)} variant="secondary" style={styles.actionButton} />
          </View>
        ) : null}
        {isGroup && draft.backendRoundId ? (
          <View style={styles.row}>
            <AppButton title="Participant Companion" onPress={() => router.push(`/round/companion/${draft.backendRoundId}` as any)} variant="secondary" style={styles.actionButton} />
          </View>
        ) : null}
        {draft.groupGameMode === 'bingo_bango_bongo' && draft.backendRoundId ? (
          <View style={styles.row}>
            <AppButton title="Open BBB Live Board" onPress={() => router.push('/round/bbb-live' as any)} variant="secondary" style={styles.actionButton} />
            <AppButton title="BBB History" onPress={() => router.push(`/round/history/${draft.id}` as any)} variant="secondary" style={styles.actionButton} />
          </View>
        ) : null}
        {draft.groupGameMode === 'skins' && draft.backendRoundId ? (
          <View style={styles.row}>
            <AppButton title="Open Skins Live Board" onPress={() => router.push('/round/skins-live' as any)} variant="secondary" style={styles.actionButton} />
            <AppButton title="Skins History" onPress={() => router.push(`/round/skins-history/${draft.id}` as any)} variant="secondary" style={styles.actionButton} />
          </View>
        ) : null}
        {draft.groupGameMode === 'nassau' && draft.backendRoundId ? (
          <View style={styles.row}>
            <AppButton title="Open Nassau Live Board" onPress={() => router.push('/round/nassau-live' as any)} variant="secondary" style={styles.actionButton} />
            <AppButton title="Nassau History" onPress={() => router.push(`/round/nassau-history/${draft.id}` as any)} variant="secondary" style={styles.actionButton} />
          </View>
        ) : null}
        {draft.groupGameMode === 'wolf' && draft.backendRoundId ? (
          <View style={styles.row}>
            <AppButton title="Open Wolf Live Board" onPress={() => router.push('/round/wolf-live' as any)} variant="secondary" style={styles.actionButton} />
            <AppButton title="Wolf History" onPress={() => router.push(`/round/wolf-history/${draft.id}` as any)} variant="secondary" style={styles.actionButton} />
          </View>
        ) : null}
        {draft.roundMode !== 'tournament' ? (
          <View style={styles.row}>
            <AppButton title={getDeleteCurrentRoundButtonLabel(draft)} onPress={handleDeleteCurrentRound} variant="ghost" style={styles.actionButton} />
          </View>
        ) : null}
        {syncStatusMessage ? (
          <Text style={styles.syncMessage}>{syncStatusMessage}</Text>
        ) : null}
      </SectionCard>

      </ScrollView>
    </BrandedScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { gap: 16, paddingBottom: 8 },
  bodyWrap: { flex: 1 },
  empty: { flex: 1, padding: 20, gap: 16, justifyContent: 'center' },
  blankState: { minHeight: 180, justifyContent: 'center' },
  stack: { gap: 12 },
  title: { fontSize: 28, fontWeight: '800', color: '#132117' },
  subtitle: { fontSize: 15, color: '#5a6b61', lineHeight: 22 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 14 },
  actionButton: { flexGrow: 1, flexBasis: 168, minWidth: 168 },
  groupCard: { marginTop: 14, backgroundColor: '#eef3ec', borderRadius: 14, padding: 12, gap: 6 },
  groupName: { fontSize: 18, fontWeight: '800', color: '#132117' },
  groupMeta: { fontSize: 14, color: '#5a6b61' },
  bbbWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  bbbCard: { backgroundColor: '#f8f5ee', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
  bbbName: { fontSize: 13, fontWeight: '800', color: '#132117' },
  bbbMeta: { fontSize: 12, color: '#5a6b61', marginTop: 2 },
  loadingButton: {
    minHeight: 48,
    minWidth: 168,
    borderRadius: 14,
    backgroundColor: '#d9dfd6',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexGrow: 1,
    flexBasis: 168,
  },
  loadingButtonText: { fontSize: 14, fontWeight: '700', color: '#5a6b61' },
  syncMessage: { marginTop: 12, fontSize: 14, lineHeight: 20, color: '#18341d' },
});
