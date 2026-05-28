
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BrandedScreen } from '@/components/BrandedScreen';
import { SectionCard } from '@/components/ui/SectionCard';
import {
  availableStatsTeeFilters,
  filterStatsRounds,
  filterStatsRoundsByTee,
  estimateHandicapForStatsRounds,
  loadPlayerStatsRounds,
  summarizePlayerStats,
  type StatsFilterKey,
  type StatsTeeFilterKey,
} from '@/lib/playerStats';
import { useAuth } from '@/providers/AuthProvider';

export default function StatsScreen() {
  const { user, profile } = useAuth();
  const [rounds, setRounds] = useState<Awaited<ReturnType<typeof loadPlayerStatsRounds>>['rounds']>([]);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<StatsFilterKey>('all');
  const [selectedTeeFilter, setSelectedTeeFilter] = useState<StatsTeeFilterKey>('all');

  useEffect(() => {
    let active = true;

    void (async () => {
      const result = await loadPlayerStatsRounds(user?.id);
      if (!active) return;
      setRounds(result.rounds);
      setBackendError(result.backendError);
    })();

    return () => {
      active = false;
    };
  }, [user?.id]);

  const timeFilteredRounds = useMemo(() => filterStatsRounds(rounds, selectedFilter), [rounds, selectedFilter]);
  const filteredRounds = useMemo(() => filterStatsRoundsByTee(timeFilteredRounds, selectedTeeFilter), [selectedTeeFilter, timeFilteredRounds]);
  const stats = useMemo(() => summarizePlayerStats(filteredRounds), [filteredRounds]);
  const teeFilters = useMemo(() => availableStatsTeeFilters(rounds), [rounds]);
  const handicapEstimate = useMemo(
    () => estimateHandicapForStatsRounds(filteredRounds, selectedTeeFilter),
    [filteredRounds, selectedTeeFilter],
  );
  const teeBreakdown = useMemo(() => teeFilters.map((tee) => ({
    tee,
    rounds: timeFilteredRounds.filter((round) => round.teeKey === tee),
  })).filter((entry) => entry.rounds.length > 0), [teeFilters, timeFilteredRounds]);

  const filters: Array<{ key: StatsFilterKey; label: string }> = [
    { key: 'all', label: 'All Time' },
    { key: 'last5', label: 'Last 5' },
    { key: 'last10', label: 'Last 10' },
    { key: 'last20', label: 'Last 20' },
  ];

  const formatNumber = (value: number | null | undefined, digits = 1) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
    return value.toFixed(digits);
  };

  const formatPercent = (value: number | null | undefined) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
    return `${value.toFixed(1)}%`;
  };

  const emptyTitle = rounds.length > 0 ? 'No rounds match these filters' : 'No completed rounds yet';
  const emptyBody = rounds.length > 0
    ? 'Try All Time or All Tees to include more completed rounds.'
    : 'Finish and save a round in History, then personal stats will appear here.';

  const StatCard = ({ label, value, helper }: { label: string; value: string; helper?: string }) => (
    <View style={styles.card}>
      <Text style={styles.cardValue}>{value}</Text>
      <Text style={styles.cardLabel}>{label}</Text>
      {helper ? <Text style={styles.cardHelper}>{helper}</Text> : null}
    </View>
  );

  return (
    <BrandedScreen
      screenName="StatsScreen"
      title="Stats"
      subtitle="Completed rounds only"
      scroll={false}
      bodyStyle={styles.bodyWrap}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.filterRow}>
          {filters.map((filter) => (
            <Pressable
              key={filter.key}
              onPress={() => setSelectedFilter(filter.key)}
              style={({ pressed }) => [
                styles.filterChip,
                selectedFilter === filter.key ? styles.filterChipActive : null,
                pressed ? styles.filterChipPressed : null,
              ]}
            >
              <Text style={[styles.filterText, selectedFilter === filter.key ? styles.filterTextActive : null]}>
                {filter.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.filterRow}>
          {[{ key: 'all' as const, label: 'All Tees' }, ...teeFilters.map((tee) => ({ key: tee, label: tee }))].map((filter) => (
            <Pressable
              key={filter.key}
              onPress={() => setSelectedTeeFilter(filter.key)}
              style={({ pressed }) => [
                styles.filterChip,
                selectedTeeFilter === filter.key ? styles.filterChipActive : null,
                pressed ? styles.filterChipPressed : null,
              ]}
            >
              <Text style={[styles.filterText, selectedTeeFilter === filter.key ? styles.filterTextActive : null]}>
                {filter.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {stats ? (
          <>
            <SectionCard>
              <Text style={styles.sectionTitle}>Overview</Text>
              <View style={styles.cardGrid}>
                <StatCard label="Rounds" value={`${stats.roundsPlayed}`} />
                <StatCard label="Handicap" value={formatNumber(profile?.handicap ?? null)} />
                <StatCard label="Estimated Handicap" value={formatNumber(handicapEstimate.estimatedHandicap)} helper={handicapEstimate.message ?? undefined} />
                <StatCard label="Scoring Avg" value={formatNumber(stats.scoringAverage)} />
                <StatCard label="Best Round" value={`${stats.bestRound}`} />
                <StatCard label="Avg To Par" value={formatNumber(stats.averageScoreToPar)} />
                <StatCard label="Worst Round" value={`${stats.worstRound}`} />
                <StatCard label="Front 9 Avg" value={formatNumber(stats.averageFrontNine)} />
                <StatCard label="Back 9 Avg" value={formatNumber(stats.averageBackNine)} />
              </View>
            </SectionCard>

            <SectionCard>
              <Text style={styles.sectionTitle}>Tee Breakdown</Text>
              <View style={styles.cardGrid}>
                {teeBreakdown.map((entry) => {
                  const teeStats = summarizePlayerStats(entry.rounds);
                  return (
                    <StatCard
                      key={entry.tee}
                      label={`${entry.tee} Tees`}
                      value={teeStats ? formatNumber(teeStats.scoringAverage) : '--'}
                      helper={`${entry.rounds.length} round${entry.rounds.length === 1 ? '' : 's'}`}
                    />
                  );
                })}
              </View>
            </SectionCard>

            <SectionCard>
              <Text style={styles.sectionTitle}>Handicap By Tee</Text>
              <View style={styles.cardGrid}>
                {(selectedTeeFilter === 'all' ? teeBreakdown : [{ tee: selectedTeeFilter, rounds: filteredRounds }]).map((entry) => {
                  const estimate = estimateHandicapForStatsRounds(entry.rounds, entry.tee);
                  return (
                    <StatCard
                      key={`handicap-${entry.tee}`}
                      label={`${entry.tee} Tees`}
                      value={formatNumber(estimate.estimatedHandicap)}
                      helper={estimate.message ?? undefined}
                    />
                  );
                })}
              </View>
            </SectionCard>

            <SectionCard>
              <Text style={styles.sectionTitle}>Scoring Breakdown</Text>
              <View style={styles.cardGrid}>
                <StatCard label="Eagles / Round" value={formatNumber(stats.eaglesPerRound, 2)} />
                <StatCard label="Birdies / Round" value={formatNumber(stats.birdiesPerRound, 2)} />
                <StatCard label="Pars / Round" value={formatNumber(stats.parsPerRound, 2)} />
                <StatCard label="Bogeys / Round" value={formatNumber(stats.bogeysPerRound, 2)} />
                <StatCard label="Doubles / Round" value={formatNumber(stats.doublesPerRound, 2)} />
                <StatCard label="Triple+ / Round" value={formatNumber(stats.triplesOrWorsePerRound, 2)} />
              </View>
            </SectionCard>

            <SectionCard>
              <Text style={styles.sectionTitle}>Hole Type Breakdown</Text>
              <View style={styles.cardGrid}>
                <StatCard label="Par 3 Avg" value={formatNumber(stats.averagePar3Score)} helper={`To par ${formatNumber(stats.averagePar3ToPar, 2)}`} />
                <StatCard label="Par 4 Avg" value={formatNumber(stats.averagePar4Score)} helper={`To par ${formatNumber(stats.averagePar4ToPar, 2)}`} />
                <StatCard label="Par 5 Avg" value={formatNumber(stats.averagePar5Score)} helper={`To par ${formatNumber(stats.averagePar5ToPar, 2)}`} />
              </View>
            </SectionCard>

            <SectionCard>
              <Text style={styles.sectionTitle}>Scoring Percentages</Text>
              <View style={styles.cardGrid}>
                <StatCard label="Par or Better" value={formatPercent(stats.parOrBetterPct)} />
                <StatCard label="Bogey or Better" value={formatPercent(stats.bogeyOrBetterPct)} />
                <StatCard label="Double Avoidance" value={formatPercent(stats.doubleBogeyAvoidancePct)} />
              </View>
            </SectionCard>

            {stats.puttsPerRound !== null || stats.puttsPerHole !== null || stats.threePuttsPerRound !== null ? (
              <SectionCard>
                <Text style={styles.sectionTitle}>Putting</Text>
                <View style={styles.cardGrid}>
                  {stats.puttsPerRound !== null ? <StatCard label="Putts / Round" value={formatNumber(stats.puttsPerRound)} /> : null}
                  {stats.puttsPerHole !== null ? <StatCard label="Putts / Hole" value={formatNumber(stats.puttsPerHole, 2)} /> : null}
                  {stats.threePuttsPerRound !== null ? <StatCard label="Three-Putts / Round" value={formatNumber(stats.threePuttsPerRound, 2)} /> : null}
                  {stats.threePuttAvoidancePct !== null ? <StatCard label="Three-Putt Avoidance" value={formatPercent(stats.threePuttAvoidancePct)} /> : null}
                </View>
              </SectionCard>
            ) : null}

            {stats.fairwaysHitPct !== null || stats.girPct !== null || stats.scramblingPct !== null || stats.penaltiesPerRound !== null || stats.penaltyHolesPerRound !== null ? (
              <SectionCard>
                <Text style={styles.sectionTitle}>Accuracy</Text>
                <View style={styles.cardGrid}>
                  {stats.fairwaysHitPct !== null ? <StatCard label="Fairways Hit" value={formatPercent(stats.fairwaysHitPct)} /> : null}
                  {stats.girPct !== null ? <StatCard label="GIR" value={formatPercent(stats.girPct)} /> : null}
                  {stats.scramblingPct !== null ? <StatCard label="Scrambling" value={formatPercent(stats.scramblingPct)} /> : null}
                  {stats.penaltiesPerRound !== null ? <StatCard label="Penalties / Round" value={formatNumber(stats.penaltiesPerRound, 2)} /> : null}
                  {stats.penaltyHolesPerRound !== null ? <StatCard label="Penalty Holes / Round" value={formatNumber(stats.penaltyHolesPerRound, 2)} /> : null}
                </View>
              </SectionCard>
            ) : null}
          </>
        ) : (
          <SectionCard>
            <Text style={styles.emptyTitle}>{emptyTitle}</Text>
            <Text style={styles.emptyBody}>{emptyBody}</Text>
          </SectionCard>
        )}

        {backendError ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>Backend rounds unavailable</Text>
            <Text style={styles.emptyBody}>{backendError}</Text>
            <Text style={styles.emptyBody}>Showing local completed rounds that are already saved on this device.</Text>
          </SectionCard>
        ) : null}
      </ScrollView>
    </BrandedScreen>
  );
}

const styles = StyleSheet.create({
  bodyWrap: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    padding: 16,
    gap: 16,
    paddingBottom: 28,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d9d1c3',
    backgroundColor: '#fffdf8',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  filterChipActive: {
    backgroundColor: '#18341d',
    borderColor: '#18341d',
  },
  filterChipPressed: {
    opacity: 0.9,
  },
  filterText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#18341d',
  },
  filterTextActive: {
    color: '#fffdf8',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#132117',
    marginBottom: 12,
  },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  card: {
    width: '47%',
    borderRadius: 16,
    backgroundColor: '#f8f5ee',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 4,
  },
  cardValue: {
    fontSize: 24,
    fontWeight: '800',
    color: '#132117',
  },
  cardLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#425247',
  },
  cardHelper: {
    fontSize: 12,
    color: '#6a766d',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#132117',
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 20,
    color: '#5a6b61',
    marginTop: 8,
  },
});
