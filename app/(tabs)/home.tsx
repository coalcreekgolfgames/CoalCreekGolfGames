import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CoalCreekHeader } from '@/components/CoalCreekHeader';
import { AppButton } from '@/components/ui/AppButton';
import {
  backNineYardageForTee,
  DEFAULT_TEE_OPTION,
  frontNineYardageForTee,
  holes,
  ratings,
  teeDisplayLabel,
  teeOptions,
  totalYardageForTee,
  type TeeOption,
} from '@/constants/course';
import {
  deleteCurrentRound,
  deleteLiveSoloRound,
  getDeleteCurrentRoundButtonLabel,
  getDeleteCurrentRoundConfirmLabel,
  getDeleteCurrentRoundMessage,
  getDeleteCurrentRoundTitle,
  isLiveSoloRound,
} from '@/lib/currentRound';
import { loadActiveDraftRound, loadRoundHistory } from '@/lib/localRound';
import {
  loadCurrentUserMatchPlayHomeState,
  loadCurrentUserTournamentsToday,
  type CurrentUserMatchPlayNotification,
  type TournamentTodayItem,
} from '@/lib/tournaments';
import { useAuth } from '@/providers/AuthProvider';
import type { LocalRoundDraft, SavedRound } from '@/types/round';

type HomeActionCardProps = {
  label: string;
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  onPress: () => void;
};

type HomeTeeCard = {
  tee: TeeOption;
  shortLabel: string;
  color: string;
};

const HOME_TEE_CARDS: HomeTeeCard[] = [
  { tee: 'Black', shortLabel: 'Black', color: '#1f2328' },
  { tee: 'Silver', shortLabel: 'Silver', color: '#b2b7be' },
  { tee: 'Blue', shortLabel: 'Blue', color: '#2f67c8' },
  { tee: 'Green', shortLabel: 'Green', color: '#5f8f61' },
];

function HomeActionCard({ label, icon, onPress }: HomeActionCardProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.homeActionCard, pressed ? styles.homeActionCardPressed : null]}
    >
      <View style={styles.homeActionIconWrap}>
        <MaterialIcons name={icon} size={20} color="#18341d" />
      </View>
      <Text style={styles.homeActionLabel}>{label}</Text>
    </Pressable>
  );
}

export default function HomeScreen() {
  const { user, loading: authLoading, authRefreshKey } = useAuth();
  const [draft, setDraft] = useState<LocalRoundDraft | null>(null);
  const [recentRound, setRecentRound] = useState<SavedRound | null>(null);
  const [tournamentsToday, setTournamentsToday] = useState<TournamentTodayItem[]>([]);
  const [activeMatchNotifications, setActiveMatchNotifications] = useState<CurrentUserMatchPlayNotification[]>([]);
  const [completedMatchPlayTournamentIds, setCompletedMatchPlayTournamentIds] = useState<string[]>([]);
  const [yardageModalVisible, setYardageModalVisible] = useState(false);
  const [selectedTee, setSelectedTee] = useState<TeeOption>(DEFAULT_TEE_OPTION);

  useFocusEffect(React.useCallback(() => {
    let active = true;

    const load = async () => {
      try {
        const [nextDraft, history, todayItems, matchPlayHomeState] = await Promise.all([
          loadActiveDraftRound(),
          loadRoundHistory(),
          user?.id ? loadCurrentUserTournamentsToday(user.id) : Promise.resolve([]),
          user?.id ? loadCurrentUserMatchPlayHomeState(user.id) : Promise.resolve({ activeNotifications: [], completedTournamentIds: [] }),
        ]);
        if (!active) return;
        setRecentRound(history[0] ?? null);
        setDraft(nextDraft);
        setTournamentsToday(todayItems);
        setActiveMatchNotifications(matchPlayHomeState.activeNotifications);
        setCompletedMatchPlayTournamentIds(matchPlayHomeState.completedTournamentIds);
      } catch (error: any) {
        console.warn('home tournament-today load failed', error?.message ?? error);
        if (!active) return;
        setRecentRound(null);
        setDraft(null);
        setTournamentsToday([]);
        setActiveMatchNotifications([]);
        setCompletedMatchPlayTournamentIds([]);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [authLoading, authRefreshKey, user?.id]));

  const totalPar = holes.reduce((sum, hole) => sum + hole.par, 0);
  const selectedTeeRatings = ratings[selectedTee];
  const selectedRatingType = 'men' in selectedTeeRatings ? 'men' : 'women';
  const selectedRating =
    'men' in selectedTeeRatings ? selectedTeeRatings.men : selectedTeeRatings.women;
  const visibleHomeTeeCards = [
    ...HOME_TEE_CARDS.filter(({ tee }) => tee === selectedTee),
    ...HOME_TEE_CARDS.filter(({ tee }) => tee !== selectedTee),
  ].slice(0, 4);
  const primaryActiveMatch = activeMatchNotifications[0] ?? null;
  const visibleTournamentsToday = tournamentsToday.filter((tournament) => !completedMatchPlayTournamentIds.includes(tournament.id));

  useEffect(() => {
    console.info('[match-play-completion-ui-debug]', {
      tournamentId: primaryActiveMatch?.tournamentId ?? null,
      matchId: primaryActiveMatch?.matchId ?? null,
      officialMatchComplete: primaryActiveMatch?.officialMatchComplete ?? null,
      scorecardComplete: primaryActiveMatch?.scorecardComplete ?? null,
      savedHoleNumbers: [],
      finishedAt: primaryActiveMatch?.finishedAt ?? null,
      shouldShowCreateMatch: null,
      shouldShowResumeMatch: !!primaryActiveMatch,
      shouldShowHomeNotification: activeMatchNotifications.length > 0,
      bottomNavVisible: null,
    });
  }, [activeMatchNotifications, primaryActiveMatch]);

  useEffect(() => {
    visibleTournamentsToday.forEach((tournament) => {
      console.info('[home-card-source-debug]', {
        source: 'tournament_today',
        tournamentId: tournament.id,
        matchId: null,
        roundId: null,
        title: 'Tournament Today',
        status: tournament.status ?? null,
        scorecardComplete: completedMatchPlayTournamentIds.includes(tournament.id),
        shouldRender: true,
        routeTarget: `/tournament/${tournament.id}`,
      });
    });
    tournamentsToday
      .filter((tournament) => !visibleTournamentsToday.some((visible) => visible.id === tournament.id))
      .forEach((tournament) => {
        console.info('[home-card-source-debug]', {
          source: 'tournament_today',
          tournamentId: tournament.id,
          matchId: null,
          roundId: null,
          title: 'Tournament Today',
          status: tournament.status ?? null,
          scorecardComplete: true,
          shouldRender: false,
          routeTarget: `/tournament/${tournament.id}`,
        });
      });
  }, [completedMatchPlayTournamentIds, tournamentsToday, visibleTournamentsToday]);

  useEffect(() => {
    activeMatchNotifications.forEach((match) => {
      console.info('[home-card-source-debug]', {
        source: 'active_match_resume',
        tournamentId: match.tournamentId,
        matchId: match.matchId,
        roundId: null,
        title: match.officialMatchComplete ? 'Resume Scorecard' : 'Resume Match',
        status: match.currentStatusLabel,
        scorecardComplete: match.scorecardComplete,
        shouldRender: true,
        routeTarget: `/tournament/${match.tournamentId}/match/${match.matchId}?hole=${match.resumeHole}`,
      });
    });
  }, [activeMatchNotifications]);

  const handlePlayRoundPress = () => {
    router.push('/round/start');
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
          },
        },
      ],
    );
  };

  const renderHero = () => (
    <View style={styles.heroSection}>
      <Image
        source={require('@/assets/images/CoalCreekClubhouse.jpg')}
        style={styles.heroImage}
      />
      <View style={styles.heroImageOverlay} />
      <LinearGradient
        pointerEvents="none"
        colors={[
          'rgba(248,245,238,0)',
          'rgba(248,245,238,0.16)',
          'rgba(248,245,238,0.48)',
          '#f8f5ee',
        ]}
        locations={[0, 0.42, 0.76, 1]}
        style={styles.heroBottomFade}
      />
      <Text style={styles.heroSubtitle}>Scenic golf. Memorable rounds.</Text>
    </View>
  );

  const renderHomeActions = () => (
    <View style={styles.actionPanel}>
      <View style={styles.homeActionGrid}>
        <HomeActionCard label="Play Round" icon="flag-circle" onPress={handlePlayRoundPress} />
        <HomeActionCard
          label="History"
          icon="history"
          onPress={() => router.push('/(tabs)/history')}
        />
        <HomeActionCard
          label="Tournaments"
          icon="emoji-events"
          onPress={() => router.push('/(tabs)/tournaments')}
        />
      </View>

      {draft && draft.roundMode !== 'tournament' ? (
        <AppButton
          title={getDeleteCurrentRoundButtonLabel(draft)}
          onPress={handleDeleteCurrentRound}
          variant="ghost"
          compact
          style={styles.deleteButton}
        />
      ) : null}
    </View>
  );

  const renderTournamentTodayCard = () => {
    if (visibleTournamentsToday.length === 0) return null;

    if (visibleTournamentsToday.length === 1) {
      const tournament = visibleTournamentsToday[0];
      return (
        <Pressable
          onPress={() => router.push(`/tournament/${tournament.id}`)}
          style={({ pressed }) => [styles.todayCard, pressed ? styles.todayCardPressed : null]}
        >
          <View style={styles.todayHeaderRow}>
            <View style={styles.todayIconWrap}>
              <MaterialIcons name="event-available" size={20} color="#6b4608" />
            </View>
            <View style={styles.todayTitleWrap}>
              <Text style={styles.todayTitle}>Tournament Today</Text>
              <Text style={styles.todayBody}>
                You are registered for {tournament.name ?? 'your tournament'} today.
              </Text>
            </View>
          </View>
          <Text style={styles.todayLink}>Tap to open tournament.</Text>
        </Pressable>
      );
    }

    return (
      <View style={styles.todayCard}>
        <View style={styles.todayHeaderRow}>
          <View style={styles.todayIconWrap}>
            <MaterialIcons name="event-note" size={20} color="#6b4608" />
          </View>
          <View style={styles.todayTitleWrap}>
            <Text style={styles.todayTitle}>Tournaments Today</Text>
            <Text style={styles.todayBody}>
              You have {visibleTournamentsToday.length} tournaments scheduled today.
            </Text>
          </View>
        </View>
        <View style={styles.todayList}>
          {visibleTournamentsToday.map((tournament) => (
            <Pressable
              key={tournament.id}
              onPress={() => router.push(`/tournament/${tournament.id}`)}
              style={({ pressed }) => [styles.todayRow, pressed ? styles.todayRowPressed : null]}
            >
              <View style={styles.todayRowTextWrap}>
                <Text style={styles.todayRowTitle}>{tournament.name ?? 'Tournament'}</Text>
                <Text style={styles.todayRowMeta}>{tournament.status ?? 'Scheduled'}</Text>
              </View>
              <Text style={styles.todayRowLink}>Open</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  };

  const renderActiveMatchCard = () => {
    if (activeMatchNotifications.length === 0) return null;

    if (activeMatchNotifications.length === 1) {
      const match = activeMatchNotifications[0];
      return (
        <Pressable
          onPress={() => router.push(`/tournament/${match.tournamentId}/match/${match.matchId}?hole=${match.resumeHole}`)}
          style={({ pressed }) => [styles.resumeCard, pressed ? styles.todayCardPressed : null]}
        >
          <View style={styles.todayHeaderRow}>
            <View style={styles.resumeIconWrap}>
              <MaterialIcons name="sports-golf" size={20} color="#0f5f2c" />
            </View>
            <View style={styles.todayTitleWrap}>
              <Text style={styles.resumeTitle}>
                {match.officialMatchComplete ? 'Resume Scorecard' : 'Resume Match'}
              </Text>
              <Text style={styles.todayBody}>
                {match.playerAName} vs {match.playerBName} - Hole {match.resumeHole}
              </Text>
              <Text style={styles.resumeMeta}>{match.currentStatusLabel}</Text>
            </View>
          </View>
          <Text style={styles.resumeLink}>Tap to continue scoring.</Text>
        </Pressable>
      );
    }

    return (
      <View style={styles.resumeCard}>
        <View style={styles.todayHeaderRow}>
          <View style={styles.resumeIconWrap}>
            <MaterialIcons name="sports-golf" size={20} color="#0f5f2c" />
          </View>
          <View style={styles.todayTitleWrap}>
            <Text style={styles.resumeTitle}>Active Match Scorecards</Text>
            <Text style={styles.todayBody}>
              You have {activeMatchNotifications.length} match scorecards ready to resume.
            </Text>
          </View>
        </View>
        <View style={styles.todayList}>
          {activeMatchNotifications.map((match) => (
            <Pressable
              key={match.matchId}
              onPress={() => router.push(`/tournament/${match.tournamentId}/match/${match.matchId}?hole=${match.resumeHole}`)}
              style={({ pressed }) => [styles.todayRow, pressed ? styles.todayRowPressed : null]}
            >
              <View style={styles.todayRowTextWrap}>
                <Text style={styles.todayRowTitle}>{match.playerAName} vs {match.playerBName}</Text>
                <Text style={styles.todayRowMeta}>Hole {match.resumeHole} - {match.currentStatusLabel}</Text>
              </View>
              <Text style={styles.resumeRowLink}>Resume</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  };

  const renderCourseYardageCard = () => (
    <Pressable
      onPress={() => setYardageModalVisible(true)}
      accessibilityRole="button"
      style={styles.yardagePressable}
    >
      <View style={styles.yardageCard}>
        <View style={styles.yardageHeaderRow}>
          <View style={styles.yardageIconWrap}>
            <MaterialIcons name="golf-course" size={20} color="#18341d" />
          </View>
          <View style={styles.yardageTitleWrap}>
            <Text style={styles.sectionTitle}>Course Yardage</Text>
            <Text style={styles.noteText}>Tap to choose a tee box</Text>
          </View>
          <MaterialIcons name="chevron-right" size={20} color="#48604d" />
        </View>

        <Text style={styles.yardageSummaryText}>
          {selectedTee} selected - {totalYardageForTee(selectedTee)} yds - Par {totalPar}
        </Text>

        <View style={styles.teeCardGrid}>
          {visibleHomeTeeCards.map(({ tee, shortLabel, color }) => {
            const isSelected = tee === selectedTee;
            const teeRatings = ratings[tee];
            const teeRating =
              'men' in teeRatings
                ? teeRatings.men
                : 'women' in teeRatings
                  ? teeRatings.women
                  : null;
            return (
              <View key={tee} style={[styles.teeCard, isSelected ? styles.teeCardSelected : null]}>
                <View style={styles.teeCardHeader}>
                  <View style={[styles.teeColorDot, { backgroundColor: color }]} />
                  <Text style={styles.teeCardTitle}>{shortLabel}</Text>
                  {isSelected ? (
                    <View style={styles.teeCheckBadge}>
                      <MaterialIcons name="check" size={11} color="#fffdf8" />
                    </View>
                  ) : null}
                </View>
                <Text style={styles.teeCardYardage}>{totalYardageForTee(tee)} yds</Text>
                <Text style={styles.teeCardPar}>
                  Par {totalPar}
                  {teeRating?.slope ? ` · Slope ${teeRating.slope}` : ''}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={styles.snapshotMetaRow}>
          <Text style={styles.snapshotMetaText}>
            Front {frontNineYardageForTee(selectedTee)}  Back {backNineYardageForTee(selectedTee)}
          </Text>
          {selectedRating ? (
            <Text style={styles.snapshotMetaText}>
              {selectedRating.rating} / {selectedRating.slope}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );

  return (
    <>
      <View style={styles.screenRoot}>
        <CoalCreekHeader />
        <View style={styles.homeBodyRoot}>
          {renderHero()}

          <View style={styles.contentArea}>
            <View style={styles.bodyContent}>
              {renderHomeActions()}
              {renderActiveMatchCard()}
              {renderTournamentTodayCard()}
              {renderCourseYardageCard()}

              <View style={styles.footerMeta}>
                {recentRound ? (
                  <View style={styles.recentRoundRow}>
                    <Text style={styles.recentRoundLabel}>Recent</Text>
                    <Text style={styles.recentRoundInline}>
                      {recentRound.date} - {teeDisplayLabel(recentRound.tee)} - {recentRound.totalScore}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.flexSpacer} />
                )}
              </View>
            </View>
          </View>
        </View>
      </View>

      <Modal
        visible={yardageModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setYardageModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Course Yardage</Text>
              <Pressable onPress={() => setYardageModalVisible(false)} hitSlop={10}>
                <Text style={styles.modalClose}>Done</Text>
              </Pressable>
            </View>

            <View style={styles.teeOptionWrap}>
              {teeOptions.map((tee) => {
                const selected = tee === selectedTee;
                return (
                  <Pressable
                    key={tee}
                    onPress={() => setSelectedTee(tee)}
                    style={[styles.teeOptionChip, selected && styles.teeOptionChipActive]}
                  >
                    <Text style={[styles.teeOptionText, selected && styles.teeOptionTextActive]}>
                      {tee}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.modalSummaryGrid}>
              <View style={styles.modalSummaryCard}>
                <Text style={styles.modalSummaryValue}>{totalYardageForTee(selectedTee)}</Text>
                <Text style={styles.modalSummaryLabel}>Total Yards</Text>
              </View>
              <View style={styles.modalSummaryCard}>
                <Text style={styles.modalSummaryValue}>{totalPar}</Text>
                <Text style={styles.modalSummaryLabel}>Par</Text>
              </View>
              <View style={styles.modalSummaryCard}>
                <Text style={styles.modalSummaryValue}>{frontNineYardageForTee(selectedTee)}</Text>
                <Text style={styles.modalSummaryLabel}>Front 9</Text>
              </View>
              <View style={styles.modalSummaryCard}>
                <Text style={styles.modalSummaryValue}>{backNineYardageForTee(selectedTee)}</Text>
                <Text style={styles.modalSummaryLabel}>Back 9</Text>
              </View>
            </View>

            {selectedRating ? (
              <Text style={styles.modalRatingText}>
                {selectedRatingType === 'men' ? 'Men' : 'Women'} Rating {selectedRating.rating} / Slope {selectedRating.slope}
              </Text>
            ) : null}

            <ScrollView style={styles.holeList} contentContainerStyle={styles.holeListContent}>
              {holes.map((hole) => (
                <View key={hole.hole} style={styles.holeRow}>
                  <View>
                    <Text style={styles.holeNumberText}>Hole {hole.hole}</Text>
                    <Text style={styles.holeMetaText}>Par {hole.par} - HCP {hole.hcp}</Text>
                  </View>
                  <Text style={styles.holeYardageText}>{hole.yards[selectedTee]} yds</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  screenRoot: {
    flex: 1,
    backgroundColor: '#f8f5ee',
  },
  homeBodyRoot: {
    flex: 1,
    backgroundColor: '#f8f5ee',
  },
  heroSection: {
    height: 238,
    width: '100%',
    overflow: 'hidden',
    backgroundColor: '#18341d',
    position: 'relative',
    flexShrink: 0,
    marginTop: 0,
    marginHorizontal: 0,
    borderRadius: 0,
  },
  heroImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  heroImageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(16, 31, 19, 0.16)',
  },
  heroBottomFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 118,
  },
  heroSubtitle: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 40,
    color: '#fffdf8',
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  contentArea: {
    flex: 1,
    backgroundColor: '#f8f5ee',
    position: 'relative',
    zIndex: 2,
    elevation: 2,
    paddingTop: 0,
  },
  bodyContent: {
    flex: 1,
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 8,
  },
  actionPanel: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    marginTop: -16,
    gap: 6,
  },
  homeActionGrid: {
    flexDirection: 'row',
    gap: 6,
  },
  homeActionCard: {
    flex: 1,
    minHeight: 68,
    borderRadius: 14,
    backgroundColor: '#f8f5ee',
    borderWidth: 1,
    borderColor: 'rgba(24, 52, 29, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 8,
    gap: 5,
    shadowColor: '#132117',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  homeActionCardPressed: {
    opacity: 0.92,
  },
  homeActionIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#e7eee4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeActionLabel: {
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '800',
    color: '#18341d',
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#132117',
    marginBottom: 4,
  },
  noteText: {
    fontSize: 12,
    color: '#5a6b61',
    lineHeight: 15,
  },
  helperText: {
    fontSize: 12,
    color: '#5a6b61',
    lineHeight: 15,
  },
  deleteButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
  },
  todayCard: {
    borderRadius: 22,
    backgroundColor: '#fff5db',
    borderWidth: 1,
    borderColor: '#f0d89a',
    padding: 16,
    gap: 12,
    shadowColor: '#6b4608',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  resumeCard: {
    borderRadius: 22,
    backgroundColor: '#e8f5ea',
    borderWidth: 1,
    borderColor: '#b7dbbf',
    padding: 16,
    gap: 12,
    shadowColor: '#0f5f2c',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  todayCardPressed: {
    opacity: 0.94,
  },
  todayHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  todayIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffe8b0',
  },
  resumeIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#d7eedb',
  },
  todayTitleWrap: {
    flex: 1,
    gap: 4,
  },
  todayTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#4d3102',
  },
  todayBody: {
    fontSize: 14,
    lineHeight: 20,
    color: '#6b4f1c',
  },
  todayLink: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6b4608',
  },
  resumeTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f5f2c',
  },
  resumeMeta: {
    fontSize: 13,
    color: '#355a3d',
  },
  resumeLink: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f5f2c',
  },
  todayList: {
    gap: 10,
  },
  todayRow: {
    borderRadius: 16,
    backgroundColor: '#fffaf0',
    borderWidth: 1,
    borderColor: '#f3e3ba',
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  todayRowPressed: {
    opacity: 0.94,
  },
  todayRowTextWrap: {
    flex: 1,
    gap: 3,
  },
  todayRowTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#132117',
  },
  todayRowMeta: {
    fontSize: 13,
    color: '#6b4f1c',
    textTransform: 'capitalize',
  },
  todayRowLink: {
    fontSize: 13,
    fontWeight: '800',
    color: '#6b4608',
  },
  resumeRowLink: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f5f2c',
  },
  yardageHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  yardageIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e4ece1',
  },
  yardageTitleWrap: {
    flex: 1,
  },
  yardagePressable: {
    flexShrink: 0,
    marginTop: 0,
  },
  yardageCard: {
    backgroundColor: '#f8f5ee',
    borderWidth: 1,
    borderColor: 'rgba(24, 52, 29, 0.1)',
    borderRadius: 22,
    padding: 14,
    shadowColor: '#132117',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  yardageSummaryText: {
    marginBottom: 10,
    fontSize: 12,
    color: '#4a5f4f',
    fontWeight: '700',
  },
  teeCardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  teeCard: {
    width: '48%',
    backgroundColor: '#f3f1e8',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(24, 52, 29, 0.08)',
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 3,
  },
  teeCardSelected: {
    backgroundColor: '#eef3ec',
    borderColor: '#355a3b',
  },
  teeCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  teeColorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  teeCardTitle: {
    flex: 1,
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '800',
    color: '#18341d',
  },
  teeCheckBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#355a3b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  teeCardYardage: {
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '800',
    color: '#132117',
  },
  teeCardPar: {
    fontSize: 11,
    lineHeight: 13,
    color: '#5a6b61',
    fontWeight: '700',
  },
  snapshotMetaRow: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  snapshotMetaText: {
    fontSize: 11,
    lineHeight: 14,
    color: '#5a6b61',
    fontWeight: '600',
  },
  footerMeta: {
    marginTop: 'auto',
    gap: 4,
    paddingBottom: 2,
  },
  recentRoundRow: {
    paddingHorizontal: 4,
    gap: 2,
  },
  recentRoundLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    color: '#18341d',
  },
  recentRoundInline: {
    fontSize: 12,
    lineHeight: 16,
    color: '#5a6b61',
  },
  flexSpacer: {
    minHeight: 0,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(7, 15, 9, 0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    maxHeight: '84%',
    backgroundColor: '#fffdf8',
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(24,52,29,0.08)',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#132117',
  },
  modalClose: {
    fontSize: 15,
    fontWeight: '800',
    color: '#18341d',
  },
  teeOptionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  teeOptionChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d7dfd7',
    backgroundColor: '#f3f1e8',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  teeOptionChipActive: {
    backgroundColor: '#18341d',
    borderColor: '#18341d',
  },
  teeOptionText: {
    color: '#18341d',
    fontSize: 13,
    fontWeight: '700',
  },
  teeOptionTextActive: {
    color: '#fffdf8',
  },
  modalSummaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  modalSummaryCard: {
    width: '47%',
    backgroundColor: '#eef3ec',
    borderRadius: 16,
    padding: 12,
  },
  modalSummaryValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#132117',
  },
  modalSummaryLabel: {
    marginTop: 4,
    fontSize: 12,
    color: '#5a6b61',
  },
  modalRatingText: {
    marginBottom: 12,
    fontSize: 14,
    color: '#4a5f4f',
    fontWeight: '600',
  },
  holeList: {
    flexGrow: 0,
  },
  holeListContent: {
    gap: 10,
    paddingBottom: 4,
  },
  holeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f8f5ee',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#ece6d8',
  },
  holeNumberText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#132117',
  },
  holeMetaText: {
    marginTop: 2,
    fontSize: 12,
    color: '#5a6b61',
  },
  holeYardageText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#18341d',
  },
});
