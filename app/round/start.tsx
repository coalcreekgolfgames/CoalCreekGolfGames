import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { BrandWatermarkBackground } from '@/components/BrandWatermarkBackground';
import { CoalCreekHeader } from '@/components/CoalCreekHeader';
import { PlayerBottomNav } from '@/components/navigation/PlayerBottomNav';
import { RoundHeroActionCard } from '@/components/round/RoundHeroActionCard';
import { RoundStatsSummaryCard } from '@/components/round/RoundStatsSummaryCard';
import { loadPlayerStatsRounds, type PlayerStatsRound } from '@/lib/playerStats';
import { getRoundWelcomeFirstName } from '@/lib/roundWelcome';
import { useAuth } from '@/providers/AuthProvider';

export default function RoundChoiceScreen() {
  const { profile, user } = useAuth();
  const [statsRounds, setStatsRounds] = useState<PlayerStatsRound[]>([]);

  useEffect(() => {
    let active = true;

    void (async () => {
      const result = await loadPlayerStatsRounds(user?.id);
      if (!active) return;
      setStatsRounds(result.rounds);
    })();

    return () => {
      active = false;
    };
  }, [user?.id]);

  const welcomeName = getRoundWelcomeFirstName({ profile, user });
  const latestRound = statsRounds[0] ?? null;
  const roundsThisSeason = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return statsRounds.filter((round) => {
      const date = new Date(round.date || round.sortTimestamp);
      return !Number.isNaN(date.getTime()) && date.getFullYear() === currentYear;
    }).length;
  }, [statsRounds]);

  return (
    <BrandWatermarkBackground screenName="RoundChoiceScreen">
      <CoalCreekHeader />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.welcomeWrap}>
          <Text style={styles.welcomeTitle}>Welcome back, {welcomeName}!</Text>
          <Text style={styles.welcomeSubtitle}>Let's play some golf.</Text>
        </View>

        <View style={styles.cardStack}>
          <RoundHeroActionCard
            title="Start Round"
            subtitle="Track your game in real time"
            imageSource={require('@/assets/images/CoalCreekClubhouse.jpg')}
            onPress={() => router.push('/round/solo-start')}
            testID="round-choice-start-round-card"
          />
          <RoundStatsSummaryCard
            lastRoundScore={latestRound?.totalScore ?? null}
            lastRoundToPar={latestRound?.scoreToPar ?? null}
            handicap={profile?.handicap ?? null}
            roundsThisSeason={roundsThisSeason}
          />
          <RoundHeroActionCard
            title="Group Round"
            subtitle="Score together in real time"
            imageSource={require('@/assets/images/group-round-hero.jpg')}
            onPress={() => router.push('/round/group-start')}
            testID="round-choice-group-round-card"
          />
        </View>
      </ScrollView>
      <PlayerBottomNav />
    </BrandWatermarkBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 16, gap: 18, paddingBottom: 112 },
  welcomeWrap: { gap: 6 },
  welcomeTitle: { fontSize: 30, lineHeight: 34, fontWeight: '800', color: '#132117' },
  welcomeSubtitle: { fontSize: 17, lineHeight: 24, color: '#5a6b61' },
  cardStack: { gap: 16 },
});
