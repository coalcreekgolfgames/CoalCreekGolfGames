import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { BrandedScreen } from '@/components/BrandedScreen'
import { PlayerBottomNav } from '@/components/navigation/PlayerBottomNav'
import { GolfCanadaSection } from '@/components/round/GolfCanadaSection'
import { SectionCard } from '@/components/ui/SectionCard'
import { AppButton } from '@/components/ui/AppButton'
import { useAuth } from '@/providers/AuthProvider'
import type { GolfCanadaPostingPrep } from '@/lib/golfCanada'
import {
  currentUserCanScoreMatch,
  getTournamentMatchGolfCanadaPostingState,
  getTournamentMatchGolfCanadaPrep,
  getTournamentMatch,
  markTournamentMatchGolfCanadaPosted,
  listTournamentMatchHoles,
  resolveTournamentMatchResumeHole,
  saveTournamentMatchHole,
  type TournamentMatchHoleRecord,
  type TournamentMatchSummary,
} from '@/lib/tournaments'
import type { GolfCanadaPostingRecord } from '@/types/round'
import {
  buildDefaultMatchPlayHoleDefinitions,
  scoreMatchPlayCard,
} from '@/lib/tournaments/matchPlay'

type SaveStatus = 'idle' | 'saving' | 'saved'

function isSavedScoredHole(hole: Pick<TournamentMatchHoleRecord, 'holeNumber' | 'playerAGross' | 'playerBGross'> | null | undefined) {
  return !!hole
    && Number.isInteger(hole.holeNumber)
    && typeof hole.playerAGross === 'number'
    && Number.isFinite(hole.playerAGross)
    && typeof hole.playerBGross === 'number'
    && Number.isFinite(hole.playerBGross)
}

function bumpScore(current: number | null | undefined, delta: number) {
  const base = typeof current === 'number' && Number.isFinite(current) ? current : 0
  return Math.max(1, base + delta)
}

function getInitials(name: string) {
  const parts = name.split(' ').map((part) => part.trim()).filter(Boolean).slice(0, 2)
  if (parts.length === 0) return 'P'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
}

export default function TournamentMatchScoringScreen() {
  const { id, matchId, hole: routeHole } = useLocalSearchParams<{ id: string; matchId: string; hole?: string }>()
  const router = useRouter()
  const { user } = useAuth()

  const [loading, setLoading] = useState(true)
  const [match, setMatch] = useState<TournamentMatchSummary | null>(null)
  const [holes, setHoles] = useState<TournamentMatchHoleRecord[]>([])
  const [currentHole, setCurrentHole] = useState(1)
  const [playerAGross, setPlayerAGross] = useState<number | null>(null)
  const [playerBGross, setPlayerBGross] = useState<number | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [justCompletedScorecard, setJustCompletedScorecard] = useState(false)
  const [postingBusy, setPostingBusy] = useState(false)
  const [golfCanadaPrep, setGolfCanadaPrep] = useState<GolfCanadaPostingPrep | null>(null)
  const [golfCanadaPostingState, setGolfCanadaPostingState] = useState<GolfCanadaPostingRecord | null>(null)

  const holeDefinitions = useMemo(() => buildDefaultMatchPlayHoleDefinitions(), [])
  const parsedRouteHole = useMemo(() => {
    const numeric = Number(routeHole)
    return Number.isInteger(numeric) && numeric >= 1 && numeric <= 18 ? numeric : null
  }, [routeHole])

  const load = useCallback(async () => {
    if (!matchId) {
      setMatch(null)
      setHoles([])
      setLoading(false)
      return
    }

    try {
      const [matchData, holeData] = await Promise.all([
        getTournamentMatch(matchId),
        listTournamentMatchHoles(matchId),
      ])
      setMatch(matchData)
      setHoles(holeData)
      const resumeState = resolveTournamentMatchResumeHole({
        preferredHole: parsedRouteHole,
        holes: holeData,
        isMatchComplete:
          matchData.status === 'complete'
          || matchData.status === 'tied'
          || !!matchData.finalResultLabel
          || !!matchData.winnerParticipantId,
      })
      console.info('[match-play-resume-hole-debug]', {
        matchId,
        routeHole: parsedRouteHole,
        savedHoleNumbers: resumeState.savedHoleNumbers,
        resolvedResumeHole: resumeState.resolvedResumeHole,
        isMatchComplete: resumeState.isMatchComplete,
        source: resumeState.source,
      })
      setCurrentHole(resumeState.resolvedResumeHole ?? 1)
    } catch (error: any) {
      console.error(error?.message ?? 'Failed to load match')
      setMatch(null)
      setHoles([])
    }
  }, [matchId, parsedRouteHole])

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      await load()
      setLoading(false)
    }
    void run()
  }, [load])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  useEffect(() => {
    let active = true

    const loadGolfCanadaState = async () => {
      if (!matchId || !user?.id) {
        if (!active) return
        setGolfCanadaPrep(null)
        setGolfCanadaPostingState(null)
        return
      }

      try {
        const [prep, postingState] = await Promise.all([
          getTournamentMatchGolfCanadaPrep(matchId, user.id),
          getTournamentMatchGolfCanadaPostingState(matchId),
        ])
        if (!active) return
        setGolfCanadaPrep(prep)
        setGolfCanadaPostingState(postingState)
      } catch (error: any) {
        console.error(error?.message ?? 'Failed to load Match Play Golf Canada state')
        if (!active) return
        setGolfCanadaPrep(null)
        setGolfCanadaPostingState(null)
      }
    }

    void loadGolfCanadaState()
    return () => {
      active = false
    }
  }, [matchId, user?.id, holes])

  const holesWithDraft = useMemo(() => {
    return holeDefinitions.map((definition) => {
      const savedHole = holes.find((hole) => hole.holeNumber === definition.holeNumber)
      if (definition.holeNumber === currentHole) {
        return {
          holeNumber: definition.holeNumber,
          par: definition.par ?? null,
          strokeIndex: definition.strokeIndex ?? null,
          playerAGross: playerAGross ?? savedHole?.playerAGross ?? null,
          playerBGross: playerBGross ?? savedHole?.playerBGross ?? null,
        }
      }
      return {
        holeNumber: definition.holeNumber,
        par: definition.par ?? null,
        strokeIndex: definition.strokeIndex ?? null,
        playerAGross: savedHole?.playerAGross ?? null,
        playerBGross: savedHole?.playerBGross ?? null,
      }
    })
  }, [currentHole, holeDefinitions, holes, playerAGross, playerBGross])

  const persistedScorecard = useMemo(() => {
    if (!match?.playerA || !match.playerB) return null
    return scoreMatchPlayCard({
      scoringMode: match.scoringMode,
      handicapMode: match.handicapMode,
      tieHandling: match.tieHandling,
      playerAName: match.playerA.displayName,
      playerBName: match.playerB.displayName,
      playerAPlayingHandicap: match.playerAPlayingHandicap ?? null,
      playerBPlayingHandicap: match.playerBPlayingHandicap ?? null,
      holes: holeDefinitions.map((definition) => {
        const savedHole = holes.find((hole) => hole.holeNumber === definition.holeNumber)
        return {
          holeNumber: definition.holeNumber,
          par: definition.par ?? null,
          strokeIndex: definition.strokeIndex ?? null,
          playerAGross: savedHole?.playerAGross ?? null,
          playerBGross: savedHole?.playerBGross ?? null,
        }
      }),
      totalHoles: 18,
    })
  }, [holeDefinitions, holes, match])

  const scorePreview = useMemo(() => {
    if (!match?.playerA || !match.playerB) return null
    return scoreMatchPlayCard({
      scoringMode: match.scoringMode,
      handicapMode: match.handicapMode,
      tieHandling: match.tieHandling,
      playerAName: match.playerA.displayName,
      playerBName: match.playerB.displayName,
      playerAPlayingHandicap: match.playerAPlayingHandicap ?? null,
      playerBPlayingHandicap: match.playerBPlayingHandicap ?? null,
      holes: holesWithDraft,
      totalHoles: 18,
    })
  }, [holesWithDraft, match])

  const currentHoleSaved = holes.find((hole) => hole.holeNumber === currentHole) ?? null
  const previewHole = scorePreview?.holes.find((hole) => hole.holeNumber === currentHole) ?? null
  const persistedHole = persistedScorecard?.holes.find((hole) => hole.holeNumber === currentHole) ?? null
  const savedHoleNumbers = useMemo(
    () => holes.filter((hole) => isSavedScoredHole(hole)).map((hole) => hole.holeNumber).sort((a, b) => a - b),
    [holes],
  )
  const missingHoleNumbers = useMemo(
    () => Array.from({ length: 18 }, (_, index) => index + 1).filter((holeNumber) => !savedHoleNumbers.includes(holeNumber)),
    [savedHoleNumbers],
  )
  const scorecardComplete = missingHoleNumbers.length === 0
  const scorecardSavedHoleCount = match?.scorecardSavedHoleCount ?? savedHoleNumbers.length
  const visibleStatusLabel = match?.currentStatusLabel ?? persistedScorecard?.status.statusLabel ?? 'All Square'
  const visibleLeaderId =
    persistedScorecard?.status.leader === 'a'
      ? match?.playerA?.participantId ?? null
      : persistedScorecard?.status.leader === 'b'
        ? match?.playerB?.participantId ?? null
        : null
  const visibleMargin = Math.abs(persistedScorecard?.status.margin ?? 0)
  const currentHoleDefinition = holeDefinitions.find((hole) => hole.holeNumber === currentHole) ?? holeDefinitions[0]
  const currentHoleDirty =
    (typeof playerAGross === 'number' ? playerAGross : null) !== (currentHoleSaved?.playerAGross ?? null)
    || (typeof playerBGross === 'number' ? playerBGross : null) !== (currentHoleSaved?.playerBGross ?? null)
  const finishActionVisible = scorecardComplete && !currentHoleDirty && saveStatus !== 'saving'
  const shouldShowSaveHole = !scorecardComplete || currentHoleDirty
  const shouldShowFinishScorecard = justCompletedScorecard && finishActionVisible
  const shouldShowViewFinalMatch = scorecardComplete && !currentHoleDirty
  const shouldShowGolfCanada = !!golfCanadaPrep
  const canScoreMatch = currentUserCanScoreMatch(match, user?.id)

  useEffect(() => {
    const savedHole = holes.find((hole) => hole.holeNumber === currentHole) ?? null
    const defaultPar = currentHoleDefinition?.par ?? null
    setPlayerAGross(savedHole?.playerAGross ?? defaultPar)
    setPlayerBGross(savedHole?.playerBGross ?? defaultPar)
  }, [currentHole, currentHoleDefinition?.par, holes])

  useEffect(() => {
    if (!match) return
    console.info('[match-play-status-display-debug]', {
      matchId: match.id,
      savedHoleCount: holes.length,
      currentHole,
      playerAHandicap: match.playerAPlayingHandicap ?? null,
      playerBHandicap: match.playerBPlayingHandicap ?? null,
      scoringMode: match.scoringMode,
      handicapMode: match.handicapMode,
      visibleStatusLabel,
      visibleLeaderId,
      visibleMargin,
    })
  }, [
    currentHole,
    holes.length,
    match,
    visibleLeaderId,
    visibleMargin,
    visibleStatusLabel,
  ])

  useEffect(() => {
    const holeForDebug = previewHole ?? persistedHole
    if (!holeForDebug) return
    console.info('[match-play-hole-calc-debug]', {
      holeNumber: holeForDebug.holeNumber,
      strokeIndex: holeForDebug.strokeIndex ?? null,
      playerAGross: holeForDebug.playerAGross ?? null,
      playerBGross: holeForDebug.playerBGross ?? null,
      playerAStrokes: holeForDebug.playerAStrokesReceived ?? 0,
      playerBStrokes: holeForDebug.playerBStrokesReceived ?? 0,
      playerANet: holeForDebug.playerANet ?? null,
      playerBNet: holeForDebug.playerBNet ?? null,
      holeResult: holeForDebug.winner ?? null,
    })
  }, [persistedHole, previewHole])

  useEffect(() => {
    if (!match) return
    console.info('[match-play-scorecard-complete-debug]', {
      matchId: match.id,
      currentHole,
      savedHoleNumbers,
      missingHoleNumbers,
      officialMatchComplete: !!match.officialMatchComplete,
      scorecardCompleteBeforeSave: scorecardComplete,
      scorecardCompleteAfterSave: scorecardComplete,
      finishActionVisible,
    })
  }, [
    currentHole,
    finishActionVisible,
    match,
    missingHoleNumbers,
    savedHoleNumbers,
    scorecardComplete,
  ])

  useEffect(() => {
    if (!match) return
    console.info('[match-play-completion-ui-debug]', {
      tournamentId: match.tournamentId,
      matchId: match.id,
      officialMatchComplete: !!match.officialMatchComplete,
      scorecardComplete,
      savedHoleNumbers,
      finishedAt: match.finishedAt ?? null,
      savedHoleCount: savedHoleNumbers.length,
      shouldShowScoreMatch: shouldShowSaveHole,
      shouldShowFinishScorecard: shouldShowFinishScorecard,
      shouldShowViewFinalMatch,
      shouldShowGolfCanada,
      shouldShowHomeNotification: !scorecardComplete,
      bottomNavVisible: true,
    })
  }, [
    match,
    savedHoleNumbers,
    scorecardComplete,
    shouldShowFinishScorecard,
    shouldShowGolfCanada,
    shouldShowSaveHole,
    shouldShowViewFinalMatch,
  ])

  useEffect(() => {
    if (!match) return
    const playerAUserId = match.playerA?.userId ?? null
    const playerBUserId = match.playerB?.userId ?? null
    const canScore = currentUserCanScoreMatch(match, user?.id)
    console.info('[match-play-score-access-debug]', {
      tournamentId: match.tournamentId,
      matchId: match.id,
      currentUserId: user?.id ?? null,
      playerAUserId,
      playerBUserId,
      canScore,
      reason: canScore ? 'current_user_is_match_player' : 'current_user_not_in_match',
    })
  }, [match, user?.id])

  if (loading) {
    return (
      <BrandedScreen screenName="TournamentMatchScoringScreen-loading" scroll={false}>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#18341d" />
        </View>
      </BrandedScreen>
    )
  }

  if (!match || !match.playerA || !match.playerB) {
    return (
      <BrandedScreen screenName="TournamentMatchScoringScreen-empty" scroll={false}>
        <View style={styles.loading}>
          <Text style={styles.title}>Match unavailable</Text>
          <Text style={styles.subtitle}>This match could not be loaded.</Text>
        </View>
      </BrandedScreen>
    )
  }

  const validGrossScore = (value: number | null) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 20
  const canSave = validGrossScore(playerAGross) && validGrossScore(playerBGross)
  const officialMatchComplete = !!match.officialMatchComplete
  const officialWinnerName =
    match.winnerParticipantId === match.playerA.participantId
      ? match.playerA.displayName
      : match.winnerParticipantId === match.playerB.participantId
        ? match.playerB.displayName
        : 'Winner'
  const postMatchScoringMessage =
    officialMatchComplete && match.finalResultLabel
      ? `Match won: ${officialWinnerName} wins ${match.finalResultLabel}. You can continue scoring the remaining holes for your scorecard.`
      : null
  const scorecardCompleteMessage = scorecardComplete
    ? 'Scorecard complete. Your full 18-hole scorecard has been saved.'
    : null

  const handleSaveHole = async () => {
    if (!canScoreMatch) {
      Alert.alert('Scoring unavailable', 'You can view this match, but only the match players can score it.')
      return
    }
    if (!canSave) return

    setSaveStatus('saving')
    const scorecardCompleteBeforeSave = scorecardComplete
    try {
      const result = await saveTournamentMatchHole({
        matchId: match.id,
        holeNumber: currentHole,
        playerAGross: playerAGross!,
        playerBGross: playerBGross!,
      })
      setMatch(result.match)
      setHoles(result.holes)
      setSaveStatus('saved')
      const resultSavedHoleNumbers = result.holes
        .filter((hole) => isSavedScoredHole(hole))
        .map((hole) => hole.holeNumber)
        .sort((a, b) => a - b)
      const resultMissingHoleNumbers = Array.from({ length: 18 }, (_, index) => index + 1)
        .filter((holeNumber) => !resultSavedHoleNumbers.includes(holeNumber))
      const scorecardCompleteAfterSave = resultMissingHoleNumbers.length === 0
      console.info('[match-play-scorecard-complete-debug]', {
        matchId: match.id,
        currentHole,
        savedHoleNumbers: resultSavedHoleNumbers,
        missingHoleNumbers: resultMissingHoleNumbers,
        officialMatchComplete: !!result.match.officialMatchComplete,
        scorecardCompleteBeforeSave,
        scorecardCompleteAfterSave,
        finishActionVisible: scorecardCompleteAfterSave,
      })
      if (scorecardCompleteAfterSave) {
        setJustCompletedScorecard(true)
        console.info('[match-play-finish-persist-debug]', {
          tournamentId: match.tournamentId,
          matchId: match.id,
          savedHoleNumbers: resultSavedHoleNumbers,
          scorecardComplete: true,
          finishedAtBefore: match.finishedAt ?? null,
          finishedAtAfter: result.match.finishedAt ?? null,
          updateSuccess: true,
          error: null,
        })
      }
      const nextHole = currentHole + 1

      if (!scorecardCompleteAfterSave && nextHole <= 18) {
        setTimeout(() => {
          setCurrentHole(nextHole)
          setJustCompletedScorecard(false)
          setSaveStatus('idle')
        }, 500)
      }
    } catch (error: any) {
      console.info('[match-play-finish-persist-debug]', {
        tournamentId: match.tournamentId,
        matchId: match.id,
        savedHoleNumbers,
        scorecardComplete,
        finishedAtBefore: match.finishedAt ?? null,
        finishedAtAfter: null,
        updateSuccess: false,
        error: error?.message ?? 'The hole could not be saved right now.',
      })
      console.error(error?.message ?? 'Failed to save match hole')
      Alert.alert('Save failed', error?.message ?? 'The hole could not be saved right now.')
      setSaveStatus('idle')
    }
  }

  const handleFinishScorecard = () => {
    setJustCompletedScorecard(false)
    router.push(`/tournament/${id}`)
  }

  const handleMarkGolfCanadaPosted = async () => {
    if (!matchId) return

    try {
      setPostingBusy(true)
      const nextPostingState = await markTournamentMatchGolfCanadaPosted(matchId)
      setGolfCanadaPostingState(nextPostingState)
    } catch (error: any) {
      Alert.alert('Golf Canada status unavailable', error?.message ?? 'Could not mark this match as posted.')
    } finally {
      setPostingBusy(false)
    }
  }

  return (
    <BrandedScreen screenName="TournamentMatchScoringScreen" scroll={false} bodyStyle={styles.bodyWrap}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <SectionCard>
          <Text style={styles.eyebrow}>{match.matchType === 'bracket' ? 'Match Play Bracket' : 'Singles Match Play'}</Text>
          <Text style={styles.title}>{match.playerA.displayName} vs {match.playerB.displayName}</Text>
          <Text style={styles.subtitle}>{visibleStatusLabel}</Text>

          <View style={styles.statusGrid}>
            <View style={styles.statusCard}>
              <Text style={styles.statusLabel}>Scoring</Text>
              <Text style={styles.statusValue}>{match.scoringMode === 'net' ? 'Net Match' : 'Gross Match'}</Text>
            </View>
            <View style={styles.statusCard}>
              <Text style={styles.statusLabel}>Holes Remaining</Text>
              <Text style={styles.statusValue}>{persistedScorecard?.status.holesRemaining ?? 18}</Text>
            </View>
            <View style={styles.statusCard}>
              <Text style={styles.statusLabel}>Result</Text>
              <Text style={styles.statusValue}>{match.finalResultLabel ?? persistedScorecard?.status.finalResultLabel ?? 'In Progress'}</Text>
            </View>
          </View>
        </SectionCard>

        <SectionCard>
          <Text style={styles.sectionTitle}>Hole {currentHole}</Text>
          <Text style={styles.subtitle}>
            Par {currentHoleDefinition?.par ?? '-'} - Stroke Index {currentHoleDefinition?.strokeIndex ?? '-'}
          </Text>
          <Text style={styles.holeMeta}>
            {match.scoringMode === 'net' ? 'Net Match' : 'Gross Match'} - {match.handicapMode === 'full_difference' ? 'Handicap Difference' : 'No Handicap'}
          </Text>
          <Text style={styles.holeMeta}>
            {match.playerA.displayName} handicap: {match.playerAPlayingHandicap ?? '-'} - {match.playerB.displayName} handicap: {match.playerBPlayingHandicap ?? '-'}
          </Text>
          {postMatchScoringMessage ? (
            <Text style={styles.warningText}>{postMatchScoringMessage}</Text>
          ) : null}
          {!canScoreMatch ? (
            <Text style={styles.warningText}>
              You can view this match, but only the match players can score it.
            </Text>
          ) : null}
          {scorePreview?.strokes.handicapStatus !== 'ready' && match.scoringMode === 'net' ? (
            <Text style={styles.warningText}>{scorePreview?.strokes.handicapMessage ?? 'Handicap setup is incomplete for net match play.'}</Text>
          ) : null}

          <View style={styles.scoreSection}>
            {[
              {
                id: 'a',
                name: match.playerA.displayName,
                score: playerAGross,
                strokesReceived: previewHole?.playerAStrokesReceived ?? 0,
                net: previewHole?.playerANet ?? null,
                onChange: (nextScore: number) => {
                  setPlayerAGross(nextScore)
                  setJustCompletedScorecard(false)
                  setSaveStatus('idle')
                },
              },
              {
                id: 'b',
                name: match.playerB.displayName,
                score: playerBGross,
                strokesReceived: previewHole?.playerBStrokesReceived ?? 0,
                net: previewHole?.playerBNet ?? null,
                onChange: (nextScore: number) => {
                  setPlayerBGross(nextScore)
                  setJustCompletedScorecard(false)
                  setSaveStatus('idle')
                },
              },
            ].map((row) => (
              <View key={row.id} style={styles.scoreRow}>
                <View style={styles.scoreIdentity}>
                  <View style={styles.scoreAvatar}>
                    <Text style={styles.scoreAvatarText}>{getInitials(row.name)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.scoreName}>{row.name}</Text>
                    <Text style={styles.scoreMeta}>
                      {match.scoringMode === 'net'
                        ? `Receives ${row.strokesReceived} stroke${row.strokesReceived === 1 ? '' : 's'} - Net ${row.net ?? '-'}`
                        : `Gross ${row.score ?? '-'}`}
                    </Text>
                  </View>
                </View>
                {canScoreMatch ? (
                  <View style={styles.stepper}>
                    <Pressable onPress={() => row.onChange(bumpScore(row.score, -1))} style={({ pressed }) => [styles.stepperButton, pressed ? styles.stepperPressed : null]}>
                      <Text style={styles.stepperSymbol}>-</Text>
                    </Pressable>
                    <View style={styles.stepperValueWrap}>
                      <Text style={styles.stepperValue}>{typeof row.score === 'number' ? row.score : '-'}</Text>
                    </View>
                    <Pressable onPress={() => row.onChange(bumpScore(row.score, 1))} style={({ pressed }) => [styles.stepperButton, pressed ? styles.stepperPressed : null]}>
                      <Text style={styles.stepperSymbol}>+</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.readOnlyScoreWrap}>
                    <Text style={styles.readOnlyScoreValue}>{typeof row.score === 'number' ? row.score : '-'}</Text>
                    <Text style={styles.readOnlyScoreLabel}>Read-only</Text>
                  </View>
                )}
              </View>
            ))}
          </View>

          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>Hole Result</Text>
            <Text style={styles.resultValue}>{previewHole?.resultLabel ?? 'Enter both scores to calculate the hole.'}</Text>
            <Text style={styles.resultMeta}>
              {scorecardComplete ? `${visibleStatusLabel} · Scorecard Complete` : visibleStatusLabel}
              {scorecardSavedHoleCount > 0 ? ` · Scorecard ${scorecardSavedHoleCount}/18` : ''}
            </Text>
          </View>

          {scorecardCompleteMessage ? (
            <Text style={styles.completeText}>{scorecardCompleteMessage}</Text>
          ) : null}

          {canScoreMatch && shouldShowSaveHole ? (
            <Pressable
            onPress={handleSaveHole}
            disabled={!canSave || saveStatus === 'saving'}
            style={({ pressed }) => [
              styles.saveHoleButton,
              saveStatus !== 'idle' ? styles.saveHoleButtonSaved : null,
              (!canSave || saveStatus === 'saving') ? styles.saveHoleButtonDisabled : null,
              pressed && canSave && saveStatus !== 'saving' ? styles.saveHoleButtonPressed : null,
            ]}
            >
            {saveStatus !== 'idle' ? <Text style={styles.saveHoleButtonIcon}>✓</Text> : null}
            <Text style={[styles.saveHoleButtonText, saveStatus !== 'idle' ? styles.saveHoleButtonTextSaved : null]}>
              {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Hole Saved' : 'Save Hole'}
            </Text>
            </Pressable>
          ) : null}

          {canScoreMatch && shouldShowFinishScorecard ? (
            <AppButton
              title="Finish Scorecard"
              onPress={handleFinishScorecard}
              style={styles.finishButton}
            />
          ) : null}

          {shouldShowViewFinalMatch ? (
            <View style={styles.completedActions}>
              <Text style={styles.completedLabel}>View Final Match</Text>
              <Text style={styles.completedBody}>
                This match is complete. Review the final result, your saved hole-by-hole scorecard, or post the round to Golf Canada below.
              </Text>
              <AppButton title="Back to Tournament" onPress={() => router.push(`/tournament/${id}`)} variant="secondary" />
            </View>
          ) : null}
        </SectionCard>

        <GolfCanadaSection
          postingState={golfCanadaPostingState}
          prep={golfCanadaPrep}
          description="Post your own completed 18-hole Match Play scorecard to Golf Canada using your saved gross scores."
          unavailableText="Golf Canada posting is available after an 18-hole scorecard is complete."
          onPost={() => router.push(`/round/golf-canada-webview/${match.id}?source=match-play` as any)}
          onMarkPosted={handleMarkGolfCanadaPosted}
          postingBusy={postingBusy}
        />

        <SectionCard>
          <Text style={styles.sectionTitle}>Navigation</Text>
          <View style={styles.modeRow}>
            <AppButton title="Previous Hole" onPress={() => {
              setJustCompletedScorecard(false)
              setCurrentHole((hole) => Math.max(1, hole - 1))
            }} variant="secondary" style={{ flex: 1 }} />
            <AppButton title="Next Hole" onPress={() => {
              setJustCompletedScorecard(false)
              setCurrentHole((hole) => Math.min(18, hole + 1))
            }} variant="secondary" style={{ flex: 1 }} />
          </View>
          <View style={styles.modeRow}>
            <AppButton title="Back to Tournament" onPress={() => router.push(`/tournament/${id}`)} variant="secondary" style={{ flex: 1 }} />
            <AppButton title="Open Match Board" onPress={() => router.push(`/tournament/${id}/live?matchId=${match.id}&hole=${currentHole}`)} variant="secondary" style={{ flex: 1 }} />
          </View>
        </SectionCard>
      </ScrollView>
      <PlayerBottomNav />
    </BrandedScreen>
  )
}

const styles = StyleSheet.create({
  bodyWrap: { flex: 1 },
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 16, gap: 16, paddingBottom: 112 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase', color: '#8b7447' },
  title: { fontSize: 28, fontWeight: '800', color: '#132117', marginTop: 8 },
  subtitle: { fontSize: 15, color: '#5a6b61', marginTop: 8, lineHeight: 21 },
  sectionTitle: { fontSize: 20, fontWeight: '800', color: '#132117' },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  statusCard: { flex: 1, minWidth: 100, backgroundColor: '#f7f3ea', borderRadius: 14, padding: 12 },
  statusLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.0, textTransform: 'uppercase', color: '#8b8a84' },
  statusValue: { fontSize: 16, fontWeight: '800', color: '#132117', marginTop: 6 },
  modeRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  holeMeta: { fontSize: 14, color: '#5a6b61', marginTop: 6, lineHeight: 20 },
  warningText: { fontSize: 13, lineHeight: 18, color: '#7b3e33', marginTop: 10 },
  scoreSection: { gap: 12, marginTop: 14 },
  scoreRow: { backgroundColor: '#f7f3ea', borderRadius: 16, padding: 14, gap: 12 },
  scoreIdentity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  scoreAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#fffdf8', alignItems: 'center', justifyContent: 'center' },
  scoreAvatarText: { fontSize: 14, fontWeight: '800', color: '#132117' },
  scoreName: { fontSize: 16, fontWeight: '800', color: '#132117' },
  scoreMeta: { fontSize: 13, color: '#5a6b61', marginTop: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepperButton: { width: 52, height: 44, borderRadius: 14, backgroundColor: '#18341d', alignItems: 'center', justifyContent: 'center' },
  stepperPressed: { opacity: 0.88 },
  stepperSymbol: { fontSize: 22, fontWeight: '800', color: '#fff' },
  stepperValueWrap: { minWidth: 88, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { fontSize: 34, fontWeight: '800', color: '#132117' },
  readOnlyScoreWrap: {
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#fffdf8',
    borderWidth: 1,
    borderColor: '#d9e6dc',
  },
  readOnlyScoreValue: { fontSize: 28, fontWeight: '800', color: '#132117' },
  readOnlyScoreLabel: { fontSize: 12, color: '#5a6b61', marginTop: 2 },
  resultCard: { backgroundColor: '#eef3ec', borderRadius: 14, padding: 12, gap: 6, marginTop: 14, marginBottom: 14 },
  resultLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.0, textTransform: 'uppercase', color: '#8b8a84' },
  resultValue: { fontSize: 18, fontWeight: '800', color: '#132117' },
  resultMeta: { fontSize: 14, color: '#425247' },
  completeText: { fontSize: 14, lineHeight: 20, color: '#1f5b2b', marginBottom: 14 },
  completedActions: {
    gap: 10,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#d9e6dc',
  },
  completedLabel: { fontSize: 16, fontWeight: '800', color: '#132117' },
  completedBody: { fontSize: 14, lineHeight: 20, color: '#5a6b61' },
  saveHoleButton: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: '#18341d',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  saveHoleButtonSaved: {
    backgroundColor: '#dff5e3',
    borderWidth: 1,
    borderColor: '#7db78b',
  },
  saveHoleButtonDisabled: { opacity: 0.6 },
  saveHoleButtonPressed: { opacity: 0.9 },
  saveHoleButtonIcon: { fontSize: 16, fontWeight: '800', color: '#0f5f2c' },
  saveHoleButtonText: { fontSize: 16, lineHeight: 20, fontWeight: '700', color: '#fff', textAlign: 'center' },
  saveHoleButtonTextSaved: { color: '#0f5f2c' },
  finishButton: { marginTop: 12 },
})
