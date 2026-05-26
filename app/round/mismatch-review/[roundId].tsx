import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { TournamentQuickNav } from '@/components/navigation/TournamentQuickNav';
import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { SectionCard } from '@/components/ui/SectionCard';
import { loadRoundHistory } from '@/lib/localRound';
import {
  getGroupRoundCompanionAccess,
  getGroupRoundCompanionMismatchReview,
  resolveGroupRoundCompanionMismatch,
  summarizeGroupRoundCompanionMismatchReview,
  type GroupRoundCompanionMismatchReviewRow,
  type GroupRoundCompanionMismatchReviewStatus,
} from '@/lib/groupRoundCompanions';
import { useAuth } from '@/providers/AuthProvider';

function rowKey(row: GroupRoundCompanionMismatchReviewRow) {
  return `${row.round_participant_id}-${row.hole_number}`;
}

function formatScore(value: number | null | undefined) {
  return typeof value === 'number' ? String(value) : '-';
}

function statusLabel(status: GroupRoundCompanionMismatchReviewStatus) {
  switch (status) {
    case 'no_mismatch':
      return 'No mismatch';
    case 'mismatch_exists':
      return 'Needs review';
    case 'reviewed':
      return 'Reviewed';
    case 'corrected':
      return 'Corrected';
    case 'accepted_as_official':
      return 'Official accepted';
    default:
      return 'Needs review';
  }
}

function sourceLabel(source: string | null | undefined) {
  switch (source) {
    case 'bingo_bango_bongo':
      return 'BBB official score';
    case 'skins':
      return 'Skins official score';
    case 'standard':
      return 'Group official score';
    default:
      return 'Official score';
  }
}

function logMismatchDebug(event: string, payload: Record<string, unknown>) {
  if (!__DEV__) return;
  console.debug(`[mismatch-review] ${event}`, payload);
}

function isBackendReviewableStatus(status: string | null | undefined) {
  return status === 'submitted'
    || status === 'completed'
    || status === 'confirmed'
    || status === 'finalized';
}

function isBackendReviewable(access: Awaited<ReturnType<typeof getGroupRoundCompanionAccess>>) {
  if (!access) return false;
  return isBackendReviewableStatus(access.status) || (access.official_completed_hole ?? 0) >= 18;
}

export default function GroupRoundMismatchReviewScreen() {
  const params = useLocalSearchParams<{ roundId: string }>();
  const routeRoundId = Array.isArray(params.roundId) ? params.roundId[0] : params.roundId;
  const { user } = useAuth();
  const [resolvedRoundId, setResolvedRoundId] = useState<string | null>(null);
  const [rows, setRows] = useState<GroupRoundCompanionMismatchReviewRow[]>([]);
  const [canResolve, setCanResolve] = useState(false);
  const [reviewReady, setReviewReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [resolvingKey, setResolvingKey] = useState<string | null>(null);
  const [correctedScores, setCorrectedScores] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!routeRoundId || !user?.id) {
      setResolvedRoundId(null);
      setRows([]);
      setCanResolve(false);
      setReviewReady(false);
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const history = await loadRoundHistory();
      const matchedSavedRound = history.find((entry) => entry.id === routeRoundId || entry.backendRoundId === routeRoundId) ?? null;
      const backendRoundId = matchedSavedRound?.backendRoundId ?? routeRoundId;
      logMismatchDebug('route_resolution', {
        routeRoundId,
        matchedSavedRoundId: matchedSavedRound?.id ?? null,
        matchedSavedRoundBackendRoundId: matchedSavedRound?.backendRoundId ?? null,
        matchedAsLocalSavedRoundId: matchedSavedRound?.id === routeRoundId,
        matchedAsBackendRoundId: matchedSavedRound?.backendRoundId === routeRoundId,
        resolvedBackendRoundId: backendRoundId,
      });
      setResolvedRoundId(backendRoundId);

      const [access, reviewRows] = await Promise.all([
        getGroupRoundCompanionAccess(backendRoundId, user.id),
        getGroupRoundCompanionMismatchReview(backendRoundId),
      ]);
      const scorekeeper = access?.is_scorer === true
        || access?.created_by_user_id === user.id
        || access?.scoring_user_id === user.id;
      const backendReviewReady = isBackendReviewable(access);
      setCanResolve(scorekeeper && backendReviewReady);
      setReviewReady(backendReviewReady);
      setRows(scorekeeper ? reviewRows : reviewRows.filter((row) => row.user_id === user.id));
      setCorrectedScores((current) => {
        const next = { ...current };
        reviewRows.forEach((row) => {
          const key = rowKey(row);
          if (!next[key]) {
            next[key] = String(row.corrected_strokes ?? row.official_strokes ?? row.participant_strokes);
          }
        });
        return next;
      });
    } catch (nextError: any) {
      setError(nextError?.message ?? 'Mismatch review is unavailable.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [routeRoundId, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => summarizeGroupRoundCompanionMismatchReview(rows), [rows]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
  };

  const handleResolve = async (
    row: GroupRoundCompanionMismatchReviewRow,
    mode: 'reviewed' | 'corrected' | 'accepted_as_official',
    correctedStrokes?: number | null,
  ) => {
    if (!canResolve) {
      logMismatchDebug('resolve_blocked', {
        routeRoundId,
        resolvedRoundId,
        rowRoundId: row.round_id,
        rowRoundParticipantId: row.round_participant_id,
        holeNumber: row.hole_number,
        mode,
        correctedStrokes: mode === 'corrected' ? correctedStrokes ?? null : null,
        reason: 'canResolve_false',
        reviewReady,
      });
      return;
    }

    const key = rowKey(row);
    setResolvingKey(key);
    try {
      const finalRoundId = resolvedRoundId ?? routeRoundId ?? row.round_id;
      logMismatchDebug('resolve_action', {
        routeRoundId,
        resolvedRoundId,
        rowRoundId: row.round_id,
        rowRoundParticipantId: row.round_participant_id,
        holeNumber: row.hole_number,
        mode,
        correctedStrokes: mode === 'corrected' ? correctedStrokes ?? null : null,
        finalRoundId,
      });
      logMismatchDebug('resolve_before_helper', {
        routeRoundId,
        resolvedRoundId,
        rowRoundId: row.round_id,
        rowRoundParticipantId: row.round_participant_id,
        holeNumber: row.hole_number,
        mode,
        correctedStrokes: mode === 'corrected' ? correctedStrokes ?? null : null,
        finalRoundId,
      });
      await resolveGroupRoundCompanionMismatch({
        roundId: finalRoundId,
        roundParticipantId: row.round_participant_id,
        holeNumber: row.hole_number,
        resolutionStatus: mode,
        correctedStrokes: mode === 'corrected' ? correctedStrokes ?? null : null,
        applyOfficialCorrection: mode === 'corrected',
      });
      await load();
    } catch (nextError: any) {
      logMismatchDebug('resolve_catch', {
        routeRoundId,
        resolvedRoundId,
        rowRoundId: row.round_id,
        rowRoundParticipantId: row.round_participant_id,
        holeNumber: row.hole_number,
        mode,
        message: nextError?.message ?? null,
        code: nextError?.code ?? null,
        details: nextError?.details ?? null,
        hint: nextError?.hint ?? null,
        name: nextError?.name ?? null,
        stringifiedError: String(nextError),
      });
      Alert.alert('Review not saved', nextError?.message ?? 'The mismatch resolution could not be saved.');
    } finally {
      setResolvingKey(null);
    }
  };

  const handleApplyCorrectedScore = (row: GroupRoundCompanionMismatchReviewRow) => {
    const key = rowKey(row);
    const parsed = Number.parseInt(correctedScores[key] ?? '', 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 20) {
      logMismatchDebug('corrected_score_invalid', {
        routeRoundId,
        resolvedRoundId,
        rowRoundId: row.round_id,
        rowRoundParticipantId: row.round_participant_id,
        holeNumber: row.hole_number,
        inputValue: correctedScores[key] ?? '',
      });
      Alert.alert('Check score', 'Enter a corrected score from 1 to 20.');
      return;
    }
    void handleResolve(row, 'corrected', parsed);
  };

  const handleActionTap = (
    row: GroupRoundCompanionMismatchReviewRow,
    mode: 'reviewed' | 'corrected' | 'accepted_as_official',
    correctedStrokes?: number | null,
  ) => {
    logMismatchDebug('button_tap', {
      routeRoundId,
      resolvedRoundId,
      rowRoundId: row.round_id,
      rowRoundParticipantId: row.round_participant_id,
      holeNumber: row.hole_number,
      mode,
      correctedStrokes: mode === 'corrected' ? correctedStrokes ?? null : null,
      canResolve,
      reviewReady,
      resolvingKey,
    });
    void handleResolve(row, mode, correctedStrokes);
  };

  const handleCorrectedScoreTap = (row: GroupRoundCompanionMismatchReviewRow) => {
    const key = rowKey(row);
    logMismatchDebug('button_tap', {
      routeRoundId,
      resolvedRoundId,
      rowRoundId: row.round_id,
      rowRoundParticipantId: row.round_participant_id,
      holeNumber: row.hole_number,
      mode: 'corrected_manual',
      inputValue: correctedScores[key] ?? '',
      canResolve,
      reviewReady,
      resolvingKey,
    });
    handleApplyCorrectedScore(row);
  };

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Mismatch Review</Text>
        <Text style={styles.subtitle}>
          Compare companion cross-card scores with the official group-round score after completion.
        </Text>

        {!user?.id ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>Sign in required</Text>
            <Text style={styles.body}>Sign in to review companion score status for this round.</Text>
          </SectionCard>
        ) : loading ? (
          <SectionCard>
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#18341d" />
              <Text style={styles.body}>Loading mismatch review...</Text>
            </View>
          </SectionCard>
        ) : error ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>Review unavailable</Text>
            <Text style={styles.body}>{error}</Text>
            <AppButton title="Try Again" onPress={handleRefresh} variant="secondary" disabled={refreshing} />
          </SectionCard>
        ) : (
          <>
            <SectionCard>
              <Text style={styles.sectionTitle}>{canResolve ? 'Scorekeeper Review' : 'My Cross-card Status'}</Text>
              <Text style={styles.body}>
                {canResolve
                  ? 'Resolve mismatches here. Official scores are only changed when you apply a corrected official score.'
                  : reviewReady
                    ? 'Your cross-card scores stay separate from the official score. The scorekeeper controls official corrections.'
                    : 'Mismatch review stays read-only until the backend round is completed.'}
              </Text>
              {!reviewReady ? (
                <Text style={styles.body}>
                  Backend review actions are disabled until this round reaches a completed, confirmed, finalized, or submitted backend status.
                </Text>
              ) : null}
              <View style={styles.summaryGrid}>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryValue}>{summary.unresolved}</Text>
                  <Text style={styles.summaryLabel}>Needs Review</Text>
                </View>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryValue}>{summary.resolved}</Text>
                  <Text style={styles.summaryLabel}>Resolved</Text>
                </View>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryValue}>{summary.clean}</Text>
                  <Text style={styles.summaryLabel}>Matched</Text>
                </View>
              </View>
              <AppButton title={refreshing ? 'Refreshing...' : 'Refresh'} onPress={handleRefresh} variant="secondary" disabled={refreshing} />
            </SectionCard>

            {summary.reviewComplete ? (
              <SectionCard>
                <Text style={styles.sectionTitle}>Review Complete</Text>
                <Text style={styles.body}>All participant cross-card mismatches for this round have been resolved. You can still review the final decisions below.</Text>
                <AppButton title="Finish Review" onPress={() => router.back()} />
              </SectionCard>
            ) : null}

            {rows.length === 0 ? (
              <SectionCard>
                <Text style={styles.emptyTitle}>No companion scores</Text>
                <Text style={styles.body}>No participant cross-card scores are available for this round yet.</Text>
              </SectionCard>
            ) : (
              <SectionCard>
                <Text style={styles.sectionTitle}>Hole Review</Text>
                <View style={styles.cardList}>
                  {rows.map((row) => {
                    const key = rowKey(row);
                    const resolving = resolvingKey === key;
                    const showActions = canResolve && row.review_status !== 'no_mismatch';
                    return (
                      <View key={`${row.cross_card_score_id}-${key}`} style={styles.reviewCard}>
                        <View style={styles.reviewHeader}>
                          <View style={styles.reviewTitleBlock}>
                            <Text style={styles.playerName}>{row.display_name}</Text>
                            <Text style={styles.playerMeta}>Hole {row.hole_number} - {sourceLabel(row.official_score_source)}</Text>
                          </View>
                          <View style={[styles.statusPill, row.review_status === 'mismatch_exists' ? styles.statusNeedsReview : styles.statusResolved]}>
                            <Text style={styles.statusText}>{statusLabel(row.review_status)}</Text>
                          </View>
                        </View>

                        <View style={styles.scoreGrid}>
                          <View style={styles.scoreCard}>
                            <Text style={styles.scoreValue}>{formatScore(row.official_strokes)}</Text>
                            <Text style={styles.scoreLabel}>Official</Text>
                          </View>
                          <View style={styles.scoreCard}>
                            <Text style={styles.scoreValue}>{formatScore(row.participant_strokes)}</Text>
                            <Text style={styles.scoreLabel}>Cross-card</Text>
                          </View>
                          <View style={styles.scoreCard}>
                            <Text style={styles.scoreValue}>{formatScore(row.score_delta)}</Text>
                            <Text style={styles.scoreLabel}>Delta</Text>
                          </View>
                        </View>

                        {row.resolution_notes ? <Text style={styles.playerMeta}>Resolution note: {row.resolution_notes}</Text> : null}
                        {row.participant_notes ? <Text style={styles.playerMeta}>Participant note: {row.participant_notes}</Text> : null}

                        {showActions ? (
                          <View style={styles.actionBlock}>
                            <View style={styles.actionRow}>
                              <AppButton
                                title="Accept Official"
                                onPress={() => handleActionTap(row, 'accepted_as_official')}
                                variant="secondary"
                                disabled={resolving}
                                style={styles.actionButton}
                              />
                              <AppButton
                                title="Mark Reviewed"
                                onPress={() => handleActionTap(row, 'reviewed')}
                                variant="secondary"
                                disabled={resolving}
                                style={styles.actionButton}
                              />
                            </View>
                            <AppButton
                              title="Use Cross-card Score"
                              onPress={() => handleActionTap(row, 'corrected', row.participant_strokes)}
                              variant="secondary"
                              disabled={resolving}
                            />
                            <AppInput
                              label="Corrected official score"
                              value={correctedScores[key] ?? ''}
                              onChangeText={(value) => setCorrectedScores((current) => ({ ...current, [key]: value.replace(/[^0-9]/g, '') }))}
                              keyboardType="number-pad"
                              maxLength={2}
                            />
                            <AppButton
                              title="Apply Corrected Score"
                              onPress={() => handleCorrectedScoreTap(row)}
                              disabled={resolving}
                            />
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              </SectionCard>
            )}
          </>
        )}

        <AppButton
          title={summary.reviewComplete ? 'Done' : 'Back'}
          onPress={() => router.back()}
          variant="secondary"
        />
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
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  summaryGrid: { flexDirection: 'row', gap: 10, marginVertical: 12 },
  summaryCard: { flex: 1, backgroundColor: '#eef3ec', borderRadius: 12, padding: 10, alignItems: 'center' },
  summaryValue: { fontSize: 22, fontWeight: '800', color: '#132117' },
  summaryLabel: { fontSize: 11, fontWeight: '800', color: '#5a6b61', textTransform: 'uppercase', textAlign: 'center' },
  cardList: { gap: 10, marginTop: 6 },
  reviewCard: { backgroundColor: '#f8f5ee', borderRadius: 16, padding: 12, gap: 10 },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  reviewTitleBlock: { flex: 1, gap: 2 },
  playerName: { fontSize: 16, fontWeight: '800', color: '#132117' },
  playerMeta: { fontSize: 13, color: '#5a6b61', lineHeight: 18 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  statusNeedsReview: { backgroundColor: '#efe7d5' },
  statusResolved: { backgroundColor: '#e7efe8' },
  statusText: { fontSize: 11, fontWeight: '800', color: '#18341d', textTransform: 'uppercase', textAlign: 'center' },
  scoreGrid: { flexDirection: 'row', gap: 10 },
  scoreCard: { flex: 1, backgroundColor: '#eef3ec', borderRadius: 12, padding: 10, alignItems: 'center' },
  scoreValue: { fontSize: 20, fontWeight: '800', color: '#132117' },
  scoreLabel: { fontSize: 11, fontWeight: '800', color: '#5a6b61', textTransform: 'uppercase', textAlign: 'center' },
  actionBlock: { gap: 10, marginTop: 2 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionButton: { flex: 1, minWidth: 140 },
});
