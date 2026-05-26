import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { AppButton } from '@/components/ui/AppButton';
import {
  buildGolfCanadaPostedRound,
  buildGolfCanadaPostingPrepFromRoundGameSummary,
  getGolfCanadaPostingPrep,
  GOLF_CANADA_SCORE_ENTRY_URL,
  markRoundGolfCanadaPosted,
  type GolfCanadaPostingPrep,
} from '@/lib/golfCanada';
import { getBbbHistorySummary } from '@/lib/bbbBackend';
import { loadRoundHistory, updateSavedRound } from '@/lib/localRound';
import { getNassauHistorySummary } from '@/lib/nassauBackend';
import { getRegularRoundHistoryDetail } from '@/lib/regularRoundHistory';
import { getSkinsHistorySummary } from '@/lib/skinsBackend';
import { getStandardRoundBackendDetail } from '@/lib/standardRoundBackend';
import { getTournamentMatchGolfCanadaPrep, markTournamentMatchGolfCanadaPosted } from '@/lib/tournaments';
import { getWolfHistorySummary } from '@/lib/wolfBackend';
import { useAuth } from '@/providers/AuthProvider';
import type { SavedRound } from '@/types/round';

type PlayedScore = {
  hole: number;
  score: number;
};

type InjectionMessage =
  | { source: 'coal-creek-golf-canada-helper'; type: 'score-injected'; hole: number; score: number; tagName?: string; inputType?: string | null }
  | { source: 'coal-creek-golf-canada-helper'; type: 'score-injection-failed'; reason: string; hole: number; score: number; tagName?: string | null }
  | { source: 'coal-creek-golf-canada-helper'; type: 'keyboard-hidden' };

function getPlayedScores(prep: GolfCanadaPostingPrep | null): PlayedScore[] {
  return (prep?.scores ?? [])
    .filter((entry): entry is PlayedScore => typeof entry.score === 'number')
    .map((entry) => ({ hole: entry.hole, score: entry.score }));
}

function buildScoreInjectionScript(entry: PlayedScore) {
  const score = JSON.stringify(String(entry.score));
  const hole = JSON.stringify(entry.hole);

  return `
    (function () {
      var send = function (payload) {
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      };
      var active = document.activeElement;
      var tagName = active && active.tagName ? active.tagName.toLowerCase() : null;
      var isInput = tagName === 'input' || tagName === 'textarea';
      var isEditable = active && active.isContentEditable;

      if (!active || (!isInput && !isEditable)) {
        send({
          source: 'coal-creek-golf-canada-helper',
          type: 'score-injection-failed',
          reason: 'Tap a score input on the Golf Canada page first.',
          hole: ${hole},
          score: Number(${score}),
          tagName: tagName
        });
        return true;
      }

      try {
        active.focus();

        if (isInput) {
          var prototype = tagName === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
          var descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
          if (descriptor && descriptor.set) {
            descriptor.set.call(active, ${score});
          } else {
            active.value = ${score};
          }
        } else {
          active.textContent = ${score};
        }

        var eventOptions = { bubbles: true, cancelable: true };
        active.dispatchEvent(new Event('input', eventOptions));
        active.dispatchEvent(new Event('change', eventOptions));
        active.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: ${score}, code: 'Digit' + ${score} }, eventOptions)));
        active.dispatchEvent(new KeyboardEvent('keyup', Object.assign({ key: ${score}, code: 'Digit' + ${score} }, eventOptions)));

        send({
          source: 'coal-creek-golf-canada-helper',
          type: 'score-injected',
          hole: ${hole},
          score: Number(${score}),
          tagName: tagName,
          inputType: active.type || null
        });
      } catch (error) {
        send({
          source: 'coal-creek-golf-canada-helper',
          type: 'score-injection-failed',
          reason: error && error.message ? error.message : 'Golf Canada did not accept the injected score.',
          hole: ${hole},
          score: Number(${score}),
          tagName: tagName
        });
      }

      return true;
    })();
  `;
}

export default function GolfCanadaWebViewHelperScreen() {
  const params = useLocalSearchParams<{ id: string; source?: string }>();
  const { user } = useAuth();
  const webViewRef = useRef<WebView>(null);
  const [round, setRound] = useState<SavedRound | null>(null);
  const [backendPrep, setBackendPrep] = useState<GolfCanadaPostingPrep | null>(null);
  const [resolvedBackendRoundId, setResolvedBackendRoundId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [backendPrepLoading, setBackendPrepLoading] = useState(false);
  const [scoreIndex, setScoreIndex] = useState(0);
  const [statusMessage, setStatusMessage] = useState('Tap a score field in Golf Canada, then tap Next Score.');
  const [debugMessage, setDebugMessage] = useState<string | null>(null);
  const [helperExpanded, setHelperExpanded] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [helperPanelHeight, setHelperPanelHeight] = useState(0);
  const postingSource = useMemo(() => {
    if (params.source === 'bbb' || params.source === 'skins' || params.source === 'nassau' || params.source === 'wolf' || params.source === 'standard-backend' || params.source === 'match-play') return params.source;
    return 'local';
  }, [params.source]);
  const backendRoundId = round?.backendRoundId ?? resolvedBackendRoundId ?? (postingSource === 'bbb' || postingSource === 'standard-backend' ? params.id : null);
  const backendRoundGameId = round?.backendRoundGameId ?? (postingSource === 'skins' || postingSource === 'nassau' || postingSource === 'wolf' ? params.id : null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const history = await loadRoundHistory();
      const nextRound = history.find((entry) => entry.id === params.id) ?? null;
      if (!active) return;

      setRound(nextRound);
      setLoading(false);
    };

    void load();
    return () => {
      active = false;
    };
  }, [params.id]);

  useEffect(() => {
    let active = true;

    const loadBackendPrep = async () => {
      if (!user?.id) {
        if (active) setBackendPrep(null);
        return;
      }

      if (params.source === 'match-play') {
        try {
          if (active) setBackendPrepLoading(true);
          const prep = await getTournamentMatchGolfCanadaPrep(params.id, user.id);
          if (active) setBackendPrep(prep);
        } finally {
          if (active) setBackendPrepLoading(false);
        }
        return;
      }

      if (params.source !== 'bbb' && params.source !== 'skins' && params.source !== 'nassau' && params.source !== 'wolf' && params.source !== 'standard-backend') {
        if (active) setBackendPrep(null);
        return;
      }

      try {
        if (active) setBackendPrepLoading(true);
        if (params.source === 'bbb') {
          if (!backendRoundId) {
            if (active) setBackendPrep(null);
            return;
          }

          const summary = await getBbbHistorySummary(backendRoundId);
          if (active) setResolvedBackendRoundId(summary?.round_id ?? backendRoundId);
          const regularDetail = await getRegularRoundHistoryDetail({
            roundId: backendRoundId,
            roundGameId: summary?.round_game_id ?? null,
            gameType: 'bbb',
            userId: user.id,
            source: 'detail_screen',
          }).catch(() => null);
          const sourceRound = round ?? ({
            id: backendRoundId,
            draftOwnerUserId: user.id,
            date: regularDetail?.roundDate ?? new Date().toISOString().slice(0, 10),
            tee: (regularDetail?.backendDetail.teeName ?? 'Blue') as any,
            ratingType: 'middle',
            currentHole: 18,
            holes: [],
            roundMode: 'casual_group',
            group: null,
            groupGameMode: 'bingo_bango_bongo',
            backendRoundId,
            backendRoundGameId: summary?.round_game_id ?? null,
            statsEnabled: regularDetail?.personalStatsSummary != null,
            savedAt: new Date().toISOString(),
            totalScore: regularDetail?.currentUserScore ?? 0,
            totalPutts: regularDetail?.personalStatsSummary?.totalPutts ?? 0,
            onePutts: 0,
            threePutts: 0,
            upAndDowns: regularDetail?.personalStatsSummary?.upAndDowns ?? 0,
            fairwaysHit: regularDetail?.personalStatsSummary?.fairwaysHit ?? 0,
            greensInRegulation: regularDetail?.personalStatsSummary?.greensInRegulation ?? 0,
            nearGreenCount: 0,
            penalties: regularDetail?.personalStatsSummary?.penalties ?? 0,
            doublesOrWorse: 0,
          } as unknown as SavedRound);
          if (active) {
            setBackendPrep(
              regularDetail?.golfCanadaPostingPrep
              ?? buildGolfCanadaPostingPrepFromRoundGameSummary(sourceRound, user.id, summary?.holes ?? [], summary?.standings ?? []),
            );
          }
          if (active) setBackendPrepLoading(false);
          return;
        }

        if (params.source === 'skins' && !backendRoundGameId) {
          if (active) setBackendPrep(null);
          return;
        }

        if (params.source === 'skins') {
          const summary = await getSkinsHistorySummary(backendRoundGameId!);
          if (active) setResolvedBackendRoundId(summary?.round_id ?? null);
          const sourceRound = round ?? ({
            id: summary?.round_id ?? backendRoundGameId!,
            draftOwnerUserId: user.id,
            date: new Date().toISOString().slice(0, 10),
            tee: 'Blue',
            ratingType: 'middle',
            currentHole: 18,
            holes: [],
            roundMode: 'casual_group',
            group: null,
            groupGameMode: 'skins',
            backendRoundId: summary?.round_id ?? null,
            backendRoundGameId: backendRoundGameId!,
            savedAt: new Date().toISOString(),
            totalScore: 0,
            totalPutts: 0,
            onePutts: 0,
            threePutts: 0,
            upAndDowns: 0,
            fairwaysHit: 0,
            greensInRegulation: 0,
            nearGreenCount: 0,
            penalties: 0,
            doublesOrWorse: 0,
          } as unknown as SavedRound);
          const regularDetail = summary?.round_id
            ? await getRegularRoundHistoryDetail({
              roundId: summary.round_id,
              roundGameId: backendRoundGameId!,
              gameType: 'skins',
              userId: user.id,
              source: 'detail_screen',
            }).catch(() => null)
            : null;
          if (active) {
            setBackendPrep(
              regularDetail?.golfCanadaPostingPrep
              ?? buildGolfCanadaPostingPrepFromRoundGameSummary(sourceRound, user.id, summary?.holes ?? [], summary?.standings ?? []),
            );
          }
          return;
        }

        if (params.source === 'nassau') {
          if (!backendRoundGameId) {
            if (active) setBackendPrep(null);
            return;
          }
          const summary = await getNassauHistorySummary(backendRoundGameId);
          if (active) setResolvedBackendRoundId(summary?.round_id ?? null);
          const sourceRound = round ?? ({
            id: summary?.round_id ?? backendRoundGameId,
            draftOwnerUserId: user.id,
            date: new Date().toISOString().slice(0, 10),
            tee: 'Blue',
            ratingType: 'middle',
            currentHole: 18,
            holes: [],
            roundMode: 'casual_group',
            group: null,
            groupGameMode: 'nassau',
            backendRoundId: summary?.round_id ?? null,
            backendRoundGameId,
            savedAt: new Date().toISOString(),
            totalScore: 0,
            totalPutts: 0,
            onePutts: 0,
            threePutts: 0,
            upAndDowns: 0,
            fairwaysHit: 0,
            greensInRegulation: 0,
            nearGreenCount: 0,
            penalties: 0,
            doublesOrWorse: 0,
          } as unknown as SavedRound);
          const regularDetail = summary?.round_id
            ? await getRegularRoundHistoryDetail({
              roundId: summary.round_id,
              roundGameId: backendRoundGameId,
              gameType: 'nassau',
              userId: user.id,
              source: 'detail_screen',
            }).catch(() => null)
            : null;
          if (active) {
            setBackendPrep(
              regularDetail?.golfCanadaPostingPrep
              ?? buildGolfCanadaPostingPrepFromRoundGameSummary(sourceRound, user.id, summary?.holes ?? [], summary?.standings ?? []),
            );
          }
          return;
        }

        if (params.source === 'wolf') {
          if (!backendRoundGameId) {
            if (active) setBackendPrep(null);
            return;
          }
          const summary = await getWolfHistorySummary(backendRoundGameId);
          if (active) setResolvedBackendRoundId(summary?.round_id ?? null);
          const sourceRound = round ?? ({
            id: summary?.round_id ?? backendRoundGameId,
            draftOwnerUserId: user.id,
            date: new Date().toISOString().slice(0, 10),
            tee: 'Blue',
            ratingType: 'middle',
            currentHole: 18,
            holes: [],
            roundMode: 'casual_group',
            group: null,
            groupGameMode: 'wolf',
            backendRoundId: summary?.round_id ?? null,
            backendRoundGameId,
            savedAt: new Date().toISOString(),
            totalScore: 0,
            totalPutts: 0,
            onePutts: 0,
            threePutts: 0,
            upAndDowns: 0,
            fairwaysHit: 0,
            greensInRegulation: 0,
            nearGreenCount: 0,
            penalties: 0,
            doublesOrWorse: 0,
          } as unknown as SavedRound);
          const regularDetail = summary?.round_id
            ? await getRegularRoundHistoryDetail({
              roundId: summary.round_id,
              roundGameId: backendRoundGameId,
              gameType: 'wolf',
              userId: user.id,
              source: 'detail_screen',
            }).catch(() => null)
            : null;
          if (active) {
            setBackendPrep(
              regularDetail?.golfCanadaPostingPrep
              ?? buildGolfCanadaPostingPrepFromRoundGameSummary(sourceRound, user.id, summary?.holes ?? [], summary?.standings ?? []),
            );
          }
          return;
        }

        const detail = await getStandardRoundBackendDetail(params.id, user.id);
        if (active) setResolvedBackendRoundId(detail.roundId);
        const scores = detail.holes.map((hole) => ({
          hole: hole.holeNumber,
          score: typeof hole.strokes === 'number' ? hole.strokes : null,
        }));
        const backendRound = ({
          id: detail.roundId,
          draftOwnerUserId: user.id,
          date: detail.roundDate ?? new Date().toISOString().slice(0, 10),
          tee: (detail.teeName ?? 'Blue') as any,
          ratingType: 'middle' as any,
          currentHole: Math.max(1, detail.holeCount || 1),
          holes: scores.map((entry) => ({ hole: entry.hole, score: entry.score })),
          roundMode: detail.roundMode === 'casual_group' ? 'casual_group' : 'solo',
          group: null,
          groupGameMode: 'none',
          backendRoundId: detail.roundId,
          statsEnabled: detail.statsSummary !== null,
          postingStates: null,
          savedAt: detail.roundDate ?? new Date().toISOString(),
          totalScore: detail.currentUserScore,
          totalPutts: detail.statsSummary?.totalPutts ?? 0,
          onePutts: 0,
          threePutts: 0,
          upAndDowns: detail.statsSummary?.upAndDowns ?? 0,
          fairwaysHit: detail.statsSummary?.fairwaysHit ?? 0,
          greensInRegulation: detail.statsSummary?.greensInRegulation ?? 0,
          nearGreenCount: 0,
          penalties: detail.statsSummary?.penalties ?? 0,
          doublesOrWorse: 0,
        } as SavedRound);
        if (active) setBackendPrep(buildGolfCanadaPostingPrepFromRoundGameSummary(backendRound, user.id, scores.map((entry) => ({
          hole_number: entry.hole,
          scores: [{ user_id: user.id, score: entry.score }],
        }))));
      } catch {
        if (active) setBackendPrep(null);
      } finally {
        if (active) setBackendPrepLoading(false);
      }
    };

    void loadBackendPrep();
    return () => {
      active = false;
    };
  }, [backendRoundGameId, backendRoundId, params.source, round, user?.id]);

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardVisible(true);
      setKeyboardHeight(event.endCoordinates?.height ?? 0);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardVisible(false);
      setKeyboardHeight(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const prep = useMemo(() => {
    if (!round) return backendPrep;
    return getGolfCanadaPostingPrep(round, user?.id) ?? backendPrep;
  }, [backendPrep, round, user?.id]);
  const scores = useMemo(() => getPlayedScores(prep), [prep]);
  const activeScore = scores[scoreIndex] ?? null;

  const handleNextScore = () => {
    if (!activeScore) {
      setStatusMessage('No more prepared scores to send.');
      return;
    }

    setStatusMessage(`Sending hole ${activeScore.hole}: ${activeScore.score}`);
    webViewRef.current?.injectJavaScript(buildScoreInjectionScript(activeScore));
  };

  const handlePreviousScore = () => {
    setScoreIndex((current) => Math.max(0, current - 1));
    setStatusMessage('Moved back one prepared score. Tap Next Score when the correct Golf Canada field is active.');
  };

  const handleReset = () => {
    setScoreIndex(0);
    setStatusMessage('Reset to the first played hole. Tap the first Golf Canada score field.');
  };

  const handleHideKeyboard = () => {
    webViewRef.current?.injectJavaScript(`
      (function () {
        if (document.activeElement && document.activeElement.blur) {
          document.activeElement.blur();
        }
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
          source: 'coal-creek-golf-canada-helper',
          type: 'keyboard-hidden'
        }));
        return true;
      })();
    `);
  };

  const handleMarkComplete = () => {
    if (!prep) return;

    Alert.alert(
      'Mark as posted?',
      'This only marks the round as manually posted in the app. It is not verified by Golf Canada.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark Complete',
          onPress: async () => {
            if (postingSource === 'match-play') {
              await markTournamentMatchGolfCanadaPosted(params.id);
              Alert.alert('Marked posted', 'This match scorecard is now marked as manually posted to Golf Canada.');
              return;
            }
            if (user?.id && (round?.backendRoundId ?? backendRoundId)) {
              await markRoundGolfCanadaPosted({
                roundId: round?.backendRoundId ?? backendRoundId!,
                userId: user.id,
                round,
              });
            }
            if (round) {
              const updatedRound = await updateSavedRound(round.id, (entry) =>
                buildGolfCanadaPostedRound(entry, {
                  playedAlone: prep.postingState.playedAlone === true,
                  playedWithOthers: prep.postingState.playedWithOthers === true,
                }),
              );
              if (updatedRound) {
                setRound(updatedRound);
              }
            }
            Alert.alert('Marked posted', 'This round is now marked as manually posted to Golf Canada.');
          },
        },
      ],
    );
  };

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as InjectionMessage;
      if (message.source !== 'coal-creek-golf-canada-helper') return;

      if (message.type === 'keyboard-hidden') {
        setDebugMessage('keyboard-hidden');
      } else {
        setDebugMessage(`${message.type}: hole ${message.hole}, score ${message.score}`);
      }

      if (message.type === 'keyboard-hidden') {
        setStatusMessage('Keyboard hidden. Tap a Golf Canada score field before sending the next score.');
        return;
      }

      if (message.type === 'score-injected') {
        setScoreIndex((current) => Math.min(current + 1, scores.length));
        setStatusMessage(`Sent hole ${message.hole}: ${message.score}. If Golf Canada advanced, tap Next Score again.`);
        return;
      }

      setStatusMessage(message.reason);
    } catch {
      setDebugMessage(event.nativeEvent.data);
    }
  };

  if (loading || backendPrepLoading) {
    return (
      <View style={styles.loading}>
        <Text style={styles.body}>Loading Golf Canada helper...</Text>
      </View>
    );
  }

  if (!prep || scores.length === 0) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Golf Canada Helper</Text>
        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Posting unavailable</Text>
          <Text style={styles.body}>
            {postingSource === 'match-play'
              ? 'Match Play posting is available after your own 18-hole scorecard is complete.'
              : 'Only regular solo and group rounds with your own played hole scores can use this helper.'}
          </Text>
          <AppButton title="Back" onPress={() => router.back()} variant="secondary" />
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.webViewWrap, { marginBottom: helperPanelHeight + (keyboardVisible ? keyboardHeight : 0) }]}>
        <WebView
          ref={webViewRef}
          source={{ uri: GOLF_CANADA_SCORE_ENTRY_URL }}
          onMessage={handleMessage}
          onLoadEnd={() => {
            if (__DEV__) {
              console.debug('[golf-canada-webview] page_load', {
                source: postingSource,
              });
            }
          }}
          onNavigationStateChange={(navState) => {
            if (__DEV__) {
              console.debug('[golf-canada-webview] navigation', {
                source: postingSource,
                url: navState.url,
              });
            }
          }}
          startInLoadingState
          sharedCookiesEnabled={false}
          thirdPartyCookiesEnabled
          javaScriptEnabled
          domStorageEnabled
        />
      </View>

      <View
        onLayout={(event) => setHelperPanelHeight(event.nativeEvent.layout.height)}
        style={[styles.helperPanel, { bottom: keyboardVisible ? keyboardHeight : 0 }]}
      >
        <View style={styles.compactRow}>
          <View style={styles.scoreBadge}>
            <Text style={styles.badgeLabel}>Hole</Text>
            <Text style={styles.badgeValue}>{activeScore?.hole ?? '-'}</Text>
          </View>
          <View style={styles.scoreBadge}>
            <Text style={styles.badgeLabel}>Score</Text>
            <Text style={styles.badgeValue}>{activeScore?.score ?? '-'}</Text>
          </View>
          <View style={styles.primaryControls}>
            <View style={styles.buttonRow}>
              <AppButton title="Previous" onPress={handlePreviousScore} variant="secondary" disabled={scoreIndex === 0} style={styles.rowButton} />
              <AppButton title="Next Score" onPress={handleNextScore} disabled={!activeScore} style={styles.rowButton} />
            </View>
          </View>
        </View>

        <Text style={styles.statusText} numberOfLines={2}>{statusMessage}</Text>

        <AppButton
          title={helperExpanded ? 'Hide Helper Options' : 'Show Helper Options'}
          onPress={() => setHelperExpanded((expanded) => !expanded)}
          variant="secondary"
        />

        {helperExpanded ? (
          <View style={styles.expandedPanel}>
            <View style={styles.buttonRow}>
              <AppButton title="Reset to Hole 1" onPress={handleReset} variant="secondary" style={styles.rowButton} />
              <AppButton title="Hide Keyboard" onPress={handleHideKeyboard} variant="secondary" style={styles.rowButton} />
            </View>
            <View style={styles.buttonRow}>
              <AppButton title="Back" onPress={() => router.back()} variant="secondary" style={styles.rowButton} />
              <AppButton title="Mark Complete" onPress={handleMarkComplete} variant="ghost" style={styles.rowButton} />
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.jumpRow}>
              {scores.map((entry, index) => (
                <AppButton
                  key={`gc-webview-score-${entry.hole}`}
                  title={`${entry.hole}: ${entry.score}`}
                  onPress={() => {
                    setScoreIndex(index);
                    setStatusMessage(`Jumped to hole ${entry.hole}. Tap the matching Golf Canada field, then tap Next Score.`);
                  }}
                  variant={index === scoreIndex ? 'primary' : 'secondary'}
                  style={styles.jumpButton}
                />
              ))}
            </ScrollView>

            {debugMessage ? <Text style={styles.debugText} numberOfLines={2}>{debugMessage}</Text> : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f0e7' },
  container: { flex: 1, backgroundColor: '#f4f0e7' },
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f4f0e7', padding: 16 },
  title: { fontSize: 28, fontWeight: '800', color: '#132117' },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: '#132117' },
  body: { fontSize: 13, color: '#5a6b61', lineHeight: 18 },
  panel: { backgroundColor: '#fffaf0', borderRadius: 16, padding: 14, gap: 12 },
  webViewWrap: { flex: 1, backgroundColor: '#ffffff' },
  helperPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: '#fffaf0',
    borderTopWidth: 1,
    borderTopColor: '#ded4bf',
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 14 : 10,
    gap: 8,
  },
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  primaryControls: { flex: 1 },
  scoreBadge: {
    width: 54,
    backgroundColor: '#eef3ec',
    borderRadius: 10,
    paddingVertical: 5,
    alignItems: 'center',
  },
  badgeLabel: { fontSize: 10, color: '#5a6b61', fontWeight: '800', textTransform: 'uppercase' },
  badgeValue: { fontSize: 20, color: '#132117', fontWeight: '800' },
  statusText: { fontSize: 12, color: '#5a6b61', lineHeight: 16 },
  buttonRow: { flexDirection: 'row', gap: 8 },
  rowButton: { flex: 1 },
  expandedPanel: { gap: 8 },
  jumpRow: { gap: 8, paddingVertical: 2 },
  jumpButton: { minWidth: 66 },
  debugText: { fontSize: 12, color: '#5a6b61' },
});
