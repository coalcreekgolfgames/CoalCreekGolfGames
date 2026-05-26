import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { BrandedScreen } from '@/components/BrandedScreen';
import { SectionCard } from '@/components/ui/SectionCard';
import { clearLocalOnlyTestRounds, loadRoundHistory, reconcileLocalRoundsWithBackend } from '@/lib/localRound';
import {
  getMyRoundHistory,
  historyDateFromBackendRow,
  historyTypeLabelFromBackendRow,
  inferLocalHistoryGameType,
  isValidBackendHistoryRow,
  localHistoryNumericScore,
  type MyRoundHistoryRow,
} from '@/lib/historyBackend';
import { loadCurrentUserCompletedMatchPlayHistory, type TournamentMatchPlayHistoryItem } from '@/lib/tournaments';
import { useAuth } from '@/providers/AuthProvider';
import type { SavedRound } from '@/types/round';

const DEBUG_HISTORY = false;

type HistoryItem = {
  kind: 'round' | 'match_play';
  key: string;
  routeId: string;
  savedRound: SavedRound | null;
  backendRow: MyRoundHistoryRow | null;
  matchPlayItem?: TournamentMatchPlayHistoryItem | null;
  date: string;
  typeLabel: string;
  scoreText: string;
  sortTimestamp: string;
};

function backendRowPriority(row: MyRoundHistoryRow) {
  const gameType = row.gameType ?? row.game_type ?? 'standard';
  if (gameType === 'bbb' || gameType === 'skins' || gameType === 'nassau' || gameType === 'wolf') return 2;
  return 1;
}

function selectPreferredBackendRows(rows: MyRoundHistoryRow[]) {
  const byRoundId = new Map<string, MyRoundHistoryRow>();
  rows.forEach((row) => {
    const roundId = row.roundId ?? row.round_id;
    const existing = byRoundId.get(roundId);
    if (!existing) {
      byRoundId.set(roundId, row);
      return;
    }

    const existingPriority = backendRowPriority(existing);
    const nextPriority = backendRowPriority(row);
    if (nextPriority > existingPriority) {
      byRoundId.set(roundId, row);
      return;
    }

    if (
      nextPriority === existingPriority
      && String(row.updated_at ?? row.created_at ?? '') > String(existing.updated_at ?? existing.created_at ?? '')
    ) {
      byRoundId.set(roundId, row);
    }
  });

  return Array.from(byRoundId.values());
}

function isRenderableHistoryItem(item: HistoryItem, userId?: string | null) {
  if (item.kind === 'match_play') {
    return !!item.matchPlayItem;
  }

  if (item.backendRow) {
    return isValidBackendHistoryRow(item.backendRow).valid;
  }

  if (item.savedRound) {
    return isValidLocalHistoryRound(item.savedRound, userId);
  }

  return false;
}

function historyType(round: SavedRound) {
  const baseType = round.roundMode === 'casual_group' ? 'Group' : 'Standard';
  if (round.groupGameMode === 'bingo_bango_bongo') return `${baseType} + BBB`;
  if (round.groupGameMode === 'skins') return `${baseType} + Skins`;
  if (round.groupGameMode === 'nassau') return `${baseType} + Nassau`;
  if (round.groupGameMode === 'wolf') return `${baseType} + Wolf`;
  return baseType;
}

function currentUserParticipantId(round: SavedRound, userId?: string | null) {
  if (!round.group?.participants?.length) return null;
  const exactMatch = userId
    ? round.group.participants.find((participant) => participant.type === 'app_user' && participant.id === userId)
    : null;
  if (exactMatch) return exactMatch.id;

  const draftOwnerMatch = round.draftOwnerUserId
    ? round.group.participants.find((participant) => participant.type === 'app_user' && participant.id === round.draftOwnerUserId)
    : null;
  if (draftOwnerMatch) return draftOwnerMatch.id;

  const firstAppUser = round.group.participants.find((participant) => participant.type === 'app_user');
  return firstAppUser?.id ?? null;
}

function historyScore(round: SavedRound, userId?: string | null) {
  if (round.roundMode !== 'casual_group') {
    return typeof round.totalScore === 'number' ? String(round.totalScore) : '-';
  }

  const participantId = currentUserParticipantId(round, userId);
  if (participantId) {
    const total = round.holes.reduce((sum, hole) => {
      const score = hole.groupScores?.find((entry) => entry.participantId === participantId)?.score;
      return sum + (typeof score === 'number' ? score : 0);
    }, 0);

    if (total > 0) return String(total);
  }

  return typeof round.totalScore === 'number' && round.totalScore > 0 ? String(round.totalScore) : '-';
}

function historyLocalFallbackScore(round: SavedRound, userId?: string | null) {
  return historyScore(round, userId);
}

function isValidLocalHistoryRound(round: SavedRound, userId?: string | null) {
  return localHistoryNumericScore(round, userId) > 0;
}

function historyDetailRoute(item: HistoryItem) {
  if (item.kind === 'match_play' && item.matchPlayItem) {
    return `/tournament/${item.matchPlayItem.tournamentId}/match/${item.matchPlayItem.matchId}`;
  }

  const backendRow = item.backendRow;
  const localGameType = item.savedRound ? inferLocalHistoryGameType(item.savedRound) : 'standard';
  const gameType = backendRow?.gameType ?? backendRow?.game_type ?? localGameType;

  if (gameType === 'bbb') {
    return `/round/history/${backendRow?.roundGameId ?? backendRow?.round_game_id ?? backendRow?.roundId ?? backendRow?.round_id ?? item.savedRound?.backendRoundGameId ?? item.savedRound?.backendRoundId ?? item.routeId}`;
  }

  if (gameType === 'skins') {
    return `/round/skins-history/${backendRow?.roundGameId ?? backendRow?.round_game_id ?? item.savedRound?.backendRoundGameId ?? item.routeId}`;
  }

  if (gameType === 'nassau') {
    return `/round/nassau-history/${backendRow?.roundGameId ?? backendRow?.round_game_id ?? item.savedRound?.backendRoundGameId ?? item.routeId}`;
  }

  if (gameType === 'wolf') {
    return `/round/wolf-history/${backendRow?.roundGameId ?? backendRow?.round_game_id ?? item.savedRound?.backendRoundGameId ?? item.routeId}`;
  }

  return `/round/standard-history/${backendRow?.roundId ?? backendRow?.round_id ?? item.savedRound?.backendRoundId ?? item.routeId}`;
}

function localRoundMatchesBackendRow(round: SavedRound, row: MyRoundHistoryRow) {
  if (row.round_game_id && round.backendRoundGameId === row.round_game_id) return true;
  if (round.backendRoundId && round.backendRoundId === row.round_id) return true;
  const localGameType = inferLocalHistoryGameType(round);
  if (localGameType !== (row.game_type ?? 'standard')) return false;
  return false;
}

function mergeHistory(localRounds: SavedRound[], backendRows: MyRoundHistoryRow[], userId?: string | null) {
  const matchedBackendRoundIds = new Set<string>();

  const items: HistoryItem[] = localRounds.map((round) => {
    const backendRow = backendRows.find((row) => localRoundMatchesBackendRow(round, row)) ?? null;
    if (backendRow) {
      matchedBackendRoundIds.add(backendRow.roundId ?? backendRow.round_id);
    }

    return {
      kind: 'round',
      key: `local:${round.id}`,
      routeId: round.id,
      savedRound: round,
      backendRow,
      matchPlayItem: null,
      date: backendRow ? historyDateFromBackendRow(backendRow) : round.date,
      typeLabel: backendRow ? historyTypeLabelFromBackendRow(backendRow) : historyType(round),
      scoreText:
        typeof backendRow?.current_user_score === 'number'
          ? String(backendRow.current_user_score)
          : historyLocalFallbackScore(round, userId),
      sortTimestamp: backendRow?.updated_at ?? round.savedAt ?? round.date,
    };
  });

  backendRows.forEach((row) => {
    const backendKey = row.round_game_id ?? row.round_id;
    const backendRoundId = row.roundId ?? row.round_id;
    if (matchedBackendRoundIds.has(backendRoundId)) return;

    items.push({
      kind: 'round',
      key: `backend:${backendKey}`,
      routeId: row.game_type === 'skins' || row.game_type === 'nassau' || row.game_type === 'wolf' ? (row.round_game_id ?? row.round_id) : (row.round_game_id ?? row.round_id),
      savedRound: null,
      backendRow: row,
      matchPlayItem: null,
      date: historyDateFromBackendRow(row),
      typeLabel: historyTypeLabelFromBackendRow(row),
      scoreText: typeof row.current_user_score === 'number' ? String(row.current_user_score) : '-',
      sortTimestamp: row.updated_at ?? row.created_at ?? row.round_date ?? row.round_id,
    });
  });

  return items.sort((a, b) => String(b.sortTimestamp).localeCompare(String(a.sortTimestamp)));
}

function logHistoryDebug(event: string, payload: Record<string, unknown>) {
  if (!__DEV__ || !DEBUG_HISTORY) return;
  console.log(`[history-load] ${event}`, payload);
}

function logHistoryOpen(item: HistoryItem, routeHref: string) {
  if (!__DEV__ || !DEBUG_HISTORY) return;
  console.log('[history-open] type', {
    type: item.typeLabel,
  });
  console.log('[history-open] roundId', {
    roundId: item.backendRow?.round_id ?? item.savedRound?.backendRoundId ?? item.savedRound?.id ?? null,
  });
  console.log('[history-open] roundGameId', {
    roundGameId: item.backendRow?.round_game_id ?? item.savedRound?.backendRoundGameId ?? null,
  });
  console.log('[history-open] routeHref', {
    routeHref,
  });
}

export default function HistoryScreen() {
  const { user } = useAuth();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);

  const loadHistory = useCallback(async () => {
    logHistoryDebug('session user id', {
      userId: user?.id ?? null,
    });

    let localRounds = await loadRoundHistory();
    logHistoryDebug('local saved round count', {
      count: localRounds.length,
    });

    let backendRows: MyRoundHistoryRow[] = [];
    let completedMatchPlayHistory: TournamentMatchPlayHistoryItem[] = [];
    let nextBackendError: string | null = null;

    if (user?.id) {
      try {
        backendRows = selectPreferredBackendRows(await getMyRoundHistory());
        const reconcileSummary = await reconcileLocalRoundsWithBackend({
          backendRows,
          localRounds,
        });
        if (reconcileSummary.removedCount > 0) {
          localRounds = await loadRoundHistory();
          logHistoryDebug('local rounds reconciled after backend fetch', {
            removedCount: reconcileSummary.removedCount,
            checkedCount: reconcileSummary.checkedCount,
          });
        }
        if (__DEV__ && DEBUG_HISTORY && backendRows.length > 0) {
          console.log('[history-load] sample_raw_backend_row', backendRows[0]);
          console.log('[history-load] sample_mapped_backend_row', {
            roundId: backendRows[0].roundId ?? backendRows[0].round_id,
            roundGameId: backendRows[0].roundGameId ?? backendRows[0].round_game_id,
            gameType: backendRows[0].gameType ?? backendRows[0].game_type,
            currentUserScore: backendRows[0].currentUserScore ?? backendRows[0].current_user_score,
            holesComplete: backendRows[0].holesComplete ?? backendRows[0].holes_complete,
            holeScoreRowCount: backendRows[0].holeScoreRowCount ?? backendRows[0].hole_score_row_count,
            standardScore: backendRows[0].standardScore ?? backendRows[0].standard_score ?? null,
            gameScore: backendRows[0].gameScore ?? backendRows[0].game_score ?? null,
            selectedScoreSource: backendRows[0].selectedScoreSource ?? backendRows[0].selected_score_source ?? null,
            status: backendRows[0].status ?? null,
          });
        }
        logHistoryDebug('backend rows before filter', {
          count: backendRows.length,
        });
        logHistoryDebug('backend rpc row count', {
          count: backendRows.length,
        });
        if (__DEV__ && DEBUG_HISTORY) {
          backendRows.forEach((row) => {
            console.log('[history-load] game_detected', {
              roundId: row.roundId ?? row.round_id,
              roundGameId: row.roundGameId ?? row.round_game_id,
              gameType: row.gameType ?? row.game_type,
              baseType: (row.participant_count ?? 0) > 1 || (row.player_count ?? 0) > 1 || row.round_mode === 'casual_group' ? 'Group' : 'Standard',
              displayType: historyTypeLabelFromBackendRow(row),
            });
            console.log('[history-load] game_score_source', {
              roundId: row.roundId ?? row.round_id,
              roundGameId: row.roundGameId ?? row.round_game_id,
              gameType: row.gameType ?? row.game_type,
              standardHoleScoreCount: row.standardHoleScoreCount ?? row.standard_hole_score_count ?? null,
              standardScore: row.standardScore ?? row.standard_score ?? null,
              gameHoleScoreCount: row.gameHoleScoreCount ?? row.game_hole_score_count ?? null,
              gameScore: row.gameScore ?? row.game_score ?? null,
              selectedScoreSource: row.selectedScoreSource ?? row.selected_score_source ?? null,
              selectedScore: row.currentUserScore ?? row.current_user_score ?? null,
              selectedHolesComplete: row.holesComplete ?? row.holes_complete ?? null,
            });
            console.log('[history-load] row type/game_type/status', {
              roundId: row.round_id,
              roundGameId: row.round_game_id,
              type: historyTypeLabelFromBackendRow(row),
              game_type: row.game_type,
              status: row.status,
            });
          });
        }
      } catch (error: any) {
        nextBackendError = error?.message ?? 'Backend history failed to load.';
        console.error('[history-load] backend rpc error', error);
        logHistoryDebug('backend rpc error', {
          message: nextBackendError,
        });
      }

      try {
        completedMatchPlayHistory = await loadCurrentUserCompletedMatchPlayHistory(user.id);
      } catch (error: any) {
        console.error('[match-play-history-load] error', error?.message ?? error);
      }
    }

    const validLocalRounds = localRounds.filter((round) => isValidLocalHistoryRound(round, user?.id));
    const validBackendRows = backendRows.filter((row) => {
      const currentUserScore = row.currentUserScore ?? row.current_user_score ?? null;
      const holesComplete = row.holesComplete ?? row.holes_complete ?? null;
      const holeScoreRowCount = row.holeScoreRowCount ?? row.hole_score_row_count ?? null;
      const status = row.status ?? null;
      const gameType = row.gameType ?? row.game_type ?? null;
      const result = isValidBackendHistoryRow(row);
      logHistoryDebug('valid_check', {
        roundId: row.roundId ?? row.round_id,
        roundGameId: row.roundGameId ?? row.round_game_id,
        status,
        gameType,
        currentUserScore,
        holesComplete,
        holeScoreRowCount,
        scoreType: typeof currentUserScore,
        holesType: typeof holesComplete,
        rowCountType: typeof holeScoreRowCount,
        isDraft: String(status ?? '').toLowerCase() === 'draft',
        isValid: result.valid,
        reason: result.reason,
      });
      if (!result.valid) {
        logHistoryDebug('filtered_out', {
          roundId: row.roundId ?? row.round_id,
          roundGameId: row.roundGameId ?? row.round_game_id,
          status,
          score: currentUserScore,
          holes_complete: holesComplete,
          reason: result.reason,
        });
      }
      return result.valid;
    });
    logHistoryDebug('backend rows after valid filter', {
      count: validBackendRows.length,
    });

    const mergedHistory = mergeHistory(validLocalRounds, validBackendRows, user?.id);
    const matchPlayHistoryItems: HistoryItem[] = completedMatchPlayHistory.map((entry) => ({
      kind: 'match_play',
      key: entry.key,
      routeId: entry.matchId,
      savedRound: null,
      backendRow: null,
      matchPlayItem: entry,
      date: entry.date,
      typeLabel: 'Match Play',
      scoreText: entry.grossTotal != null ? String(entry.grossTotal) : '-',
      sortTimestamp: entry.sortTimestamp,
    }));
    logHistoryDebug('merged history count before final filter', {
      count: mergedHistory.length + matchPlayHistoryItems.length,
    });
    const finalHistory = [...mergedHistory, ...matchPlayHistoryItems]
      .filter((item) => isRenderableHistoryItem(item, user?.id))
      .sort((a, b) => String(b.sortTimestamp).localeCompare(String(a.sortTimestamp)));
    logHistoryDebug('final rendered history count', {
      count: finalHistory.length,
    });
    logHistoryDebug('rendered row ids', {
      ids: finalHistory.map((item) => item.backendRow?.roundId ?? item.backendRow?.round_id ?? item.savedRound?.backendRoundId ?? item.savedRound?.id ?? item.key),
    });

    setBackendError(nextBackendError);
    setHistory(finalHistory);
  }, [user?.id]);

  useEffect(() => {
    logHistoryDebug('rendered history count', {
      count: history.length,
    });
  }, [history.length]);

  useFocusEffect(useCallback(() => {
    let active = true;
    void (async () => {
      await loadHistory();
      if (!active) return;
    })();

    return () => {
      active = false;
    };
  }, [loadHistory]));

  const handleClearLocalOnlyRounds = useCallback(() => {
    if (!__DEV__ || cleanupBusy) return;

    Alert.alert(
      'Clear local-only test rounds?',
      'This removes completed local-only rounds that are not saved to the backend. It will not remove active rounds or rounds with pending sync.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            setCleanupBusy(true);
            void (async () => {
              try {
                const summary = await clearLocalOnlyTestRounds();
                await loadHistory();

                const parts: string[] = [];
                if (summary.removedCount > 0) {
                  parts.push(`Removed ${summary.removedCount} local test round${summary.removedCount === 1 ? '' : 's'}.`);
                } else {
                  parts.push('No local-only rounds found.');
                }
                if (summary.keptUnsyncedCount > 0) {
                  parts.push(`Skipped ${summary.keptUnsyncedCount} round${summary.keptUnsyncedCount === 1 ? '' : 's'} because sync is still pending or failed.`);
                }
                if (summary.skippedActiveCount > 0) {
                  parts.push(`Skipped ${summary.skippedActiveCount} active round${summary.skippedActiveCount === 1 ? '' : 's'}.`);
                }

                Alert.alert('Cleanup complete', parts.join(' '));
              } catch (error: any) {
                Alert.alert('Cleanup failed', error?.message ?? 'Local round cleanup failed.');
              } finally {
                setCleanupBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, [cleanupBusy, loadHistory]);

  return (
    <BrandedScreen
      screenName="HistoryScreen"
      title="History"
      subtitle="Completed rounds and game detail for your saved scorecards."
      scroll={false}
      bodyStyle={styles.bodyWrap}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.subtitle}>Tap a round to open its detail page.</Text>

        {history.length === 0 ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>No rounds saved yet</Text>
            <Text style={styles.subtitle}>Finish or sync a round and it will appear here.</Text>
          </SectionCard>
        ) : (
          <View style={styles.list}>
            {history.map((item) => (
              item.kind === 'match_play' && item.matchPlayItem ? (
                <Pressable
                  key={item.key}
                  onPress={() => {
                    const routeHref = historyDetailRoute(item);
                    logHistoryOpen(item, routeHref);
                    router.push(routeHref as any);
                  }}
                  style={({ pressed }) => [styles.matchPlayCard, pressed ? styles.rowPressed : undefined]}
                >
                  <View style={styles.matchPlayHeader}>
                    <Text style={styles.matchPlayTitle}>{item.matchPlayItem.tournamentName}</Text>
                    <Text style={styles.matchPlayDate}>{item.date}</Text>
                  </View>
                  <Text style={styles.matchPlayType}>Match Play vs {item.matchPlayItem.opponentName}</Text>
                  <Text style={styles.matchPlayResult}>{item.matchPlayItem.resultLabel}</Text>
                  <Text style={styles.matchPlayMeta}>
                    {item.matchPlayItem.grossTotal != null
                      ? `18-hole gross ${item.matchPlayItem.grossTotal}`
                      : `Saved holes ${item.matchPlayItem.savedHoleCount}/18`}
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  key={item.key}
                  onPress={() => {
                    const routeHref = historyDetailRoute(item);
                    logHistoryOpen(item, routeHref);
                    router.push(routeHref as any);
                  }}
                  style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : undefined]}
                >
                  <Text style={[styles.cell, styles.dateCell]} numberOfLines={1}>{item.date}</Text>
                  <Text style={[styles.cell, styles.typeCell]} numberOfLines={1}>{item.typeLabel}</Text>
                  <Text style={[styles.cell, styles.scoreCell]} numberOfLines={1}>{item.scoreText}</Text>
                </Pressable>
              )
            ))}
          </View>
        )}

        {backendError ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>Backend history unavailable</Text>
            <Text style={styles.subtitle}>{backendError}</Text>
          </SectionCard>
        ) : null}

        {__DEV__ ? (
          <SectionCard>
            <Text style={styles.devTitle}>Developer Cleanup</Text>
            <Text style={styles.devBody}>
              Remove completed local-only test rounds that are no longer needed on this device.
            </Text>
            <Pressable
              onPress={handleClearLocalOnlyRounds}
              disabled={cleanupBusy}
              style={({ pressed }) => {
                const nextStyles = [styles.devButton, cleanupBusy ? styles.devButtonDisabled : null];
                if (pressed && !cleanupBusy) nextStyles.push(styles.devButtonPressed);
                return nextStyles;
              }}
            >
              <Text style={styles.devButtonText}>
                {cleanupBusy ? 'Cleaning up...' : 'Clear Local-Only Test Rounds'}
              </Text>
            </Pressable>
          </SectionCard>
        ) : null}
      </ScrollView>
    </BrandedScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { gap: 12, paddingBottom: 24 },
  bodyWrap: { flex: 1, padding: 16 },
  subtitle: { fontSize: 15, color: '#5a6b61', lineHeight: 22 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#132117', marginBottom: 8 },
  list: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#d8d1c4',
    backgroundColor: '#fffdf8',
  },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ece5d8',
  },
  rowPressed: { backgroundColor: '#f5f0e6' },
  matchPlayCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d8d1c4',
    backgroundColor: '#fffdf8',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  matchPlayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  matchPlayTitle: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
    color: '#132117',
  },
  matchPlayDate: {
    fontSize: 13,
    lineHeight: 18,
    color: '#5a6b61',
    fontWeight: '700',
  },
  matchPlayType: {
    fontSize: 14,
    lineHeight: 20,
    color: '#5a6b61',
    fontWeight: '700',
  },
  matchPlayResult: {
    fontSize: 15,
    lineHeight: 21,
    color: '#132117',
    fontWeight: '800',
  },
  matchPlayMeta: {
    fontSize: 13,
    lineHeight: 18,
    color: '#5a6b61',
  },
  cell: {
    fontSize: 15,
    lineHeight: 20,
    color: '#132117',
  },
  dateCell: { flex: 1.4, fontWeight: '700' },
  typeCell: { flex: 1, textAlign: 'center', color: '#5a6b61', fontWeight: '700' },
  scoreCell: { flex: 0.7, textAlign: 'right', fontWeight: '800' },
  devTitle: { fontSize: 16, fontWeight: '800', color: '#132117', marginBottom: 8 },
  devBody: { fontSize: 14, lineHeight: 20, color: '#5a6b61', marginBottom: 12 },
  devButton: {
    borderRadius: 12,
    backgroundColor: '#17351f',
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  devButtonPressed: {
    opacity: 0.92,
  },
  devButtonDisabled: {
    opacity: 0.6,
  },
  devButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fffdf8',
  },
});
