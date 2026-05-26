import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { BrandWatermarkBackground } from '@/components/BrandWatermarkBackground';
import { CoalCreekHeader } from '@/components/CoalCreekHeader';
import { PlayerBottomNav } from '@/components/navigation/PlayerBottomNav';
import { RoundHeroActionCard } from '@/components/round/RoundHeroActionCard';
import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { SectionCard } from '@/components/ui/SectionCard';
import {
  holes,
  ratingInfoFor,
  teeOptions,
  totalYardageForTee,
  type RatingType,
  type TeeOption,
} from '@/constants/course';
import { deleteCurrentRound, describeCurrentRound } from '@/lib/currentRound';
import { loadDraftRound, saveDraftRound } from '@/lib/localRound';
import { getRoundWelcomeFirstName } from '@/lib/roundWelcome';
import { useAuth } from '@/providers/AuthProvider';
import type { LocalRoundDraft } from '@/types/round';

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function SoloStartRoundScreen() {
  const { profile, user } = useAuth();
  const [date, setDate] = useState(todayIsoDate());
  const [tee, setTee] = useState<TeeOption>('Silver');
  const [ratingType, setRatingType] = useState<RatingType>('men');
  const [statsEnabled, setStatsEnabled] = useState(true);

  const rating = ratingInfoFor(tee, ratingType) as { rating: string | number; slope: string | number } | null;
  const welcomeName = getRoundWelcomeFirstName({ profile, user });

  const startFreshRound = async () => {
    const draft: LocalRoundDraft = {
      id: `${Date.now()}`,
      date,
      tee,
      ratingType,
      currentHole: 1,
      roundMode: 'solo',
      statsEnabled,
      holes: holes.map((courseHole) => ({
        hole: courseHole.hole,
        score: courseHole.par,
      })),
    };

    await saveDraftRound(draft);
    router.replace('/round/hole/1');
  };

  const handleStart = async () => {
    const existingDraft = await loadDraftRound();
    if (existingDraft && existingDraft.roundMode !== 'tournament') {
      Alert.alert(
        'Delete current round first?',
        `A ${describeCurrentRound(existingDraft)} is still on this device. Delete it before starting a new round so no stale state carries forward.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Resume Current Round',
            onPress: () => router.replace('/(tabs)/round'),
          },
          {
            text: 'Delete and Start New',
            style: 'destructive',
            onPress: async () => {
              const result = await deleteCurrentRound(existingDraft);
              await startFreshRound();
              if (result.backendCleanupError) {
                Alert.alert(
                  'Started fresh locally',
                  'The old local draft was cleared, but backend draft cleanup did not finish.',
                );
              }
            },
          },
        ],
      );
      return;
    }

    await startFreshRound();
  };

  return (
    <BrandWatermarkBackground screenName="SoloStartRoundScreen">
      <CoalCreekHeader />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.welcomeWrap}>
          <Text style={styles.welcomeTitle}>Welcome back, {welcomeName}!</Text>
          <Text style={styles.welcomeSubtitle}>Let's play some golf.</Text>
        </View>

        <RoundHeroActionCard
          title="Start Round"
          subtitle="Track your game in real time"
          imageSource={require('@/assets/images/CoalCreekClubhouse.jpg')}
          testID="solo-start-hero-card"
        />

        <SectionCard style={{ gap: 16 }}>
          <Text style={styles.sectionTitle}>Round Details</Text>
          <Text style={styles.helper}>Stats are on by default. Tap No Stats if you want a faster score-only round.</Text>
          <AppInput label="Round date" value={date} onChangeText={setDate} />

          <Text style={styles.label}>Tee</Text>
          <View style={styles.chips}>
            {teeOptions.map((option) => (
              <AppButton
                key={option}
                title={option}
                onPress={() => setTee(option)}
                variant={tee === option ? 'primary' : 'secondary'}
                style={styles.chipButton}
              />
            ))}
          </View>

          <View style={styles.inlineRow}>
            <AppButton
              title="Men's Rating"
              onPress={() => setRatingType('men')}
              variant={ratingType === 'men' ? 'primary' : 'secondary'}
              style={{ flex: 1 }}
            />
            <AppButton
              title="Women's Rating"
              onPress={() => setRatingType('women')}
              variant={ratingType === 'women' ? 'primary' : 'secondary'}
              style={{ flex: 1 }}
            />
          </View>

          <SectionCard style={{ backgroundColor: '#eef3ec', padding: 12 }}>
            <Text style={styles.meta}>Total yardage: {totalYardageForTee(tee)}</Text>
            <Text style={styles.meta}>
              Rating info: {rating ? `${rating.rating} / ${rating.slope}` : 'Not posted for this tee/rating set'}
            </Text>
          </SectionCard>
        </SectionCard>

        <SectionCard style={{ gap: 12 }}>
          <Text style={styles.sectionTitle}>Stats</Text>
          <Text style={styles.helper}>Default is on each round. Turn them off if you only want to enter score.</Text>
          <View style={styles.inlineRow}>
            <AppButton
              title="Stats On"
              onPress={() => setStatsEnabled(true)}
              variant={statsEnabled ? 'primary' : 'secondary'}
              style={{ flex: 1 }}
            />
            <AppButton
              title="No Stats"
              onPress={() => setStatsEnabled(false)}
              variant={!statsEnabled ? 'primary' : 'secondary'}
              style={{ flex: 1 }}
            />
          </View>
        </SectionCard>

        <AppButton title="Start Round" onPress={() => void handleStart()} />
      </ScrollView>
      <PlayerBottomNav />
    </BrandWatermarkBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 16, gap: 16, paddingBottom: 112 },
  welcomeWrap: { gap: 6 },
  welcomeTitle: { fontSize: 30, lineHeight: 34, fontWeight: '800', color: '#132117' },
  welcomeSubtitle: { fontSize: 17, lineHeight: 24, color: '#5a6b61' },
  label: { fontSize: 15, fontWeight: '800', color: '#132117' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chipButton: { minWidth: 120 },
  inlineRow: { flexDirection: 'row', gap: 10 },
  meta: { fontSize: 14, color: '#132117', lineHeight: 20 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: '#132117' },
  helper: { fontSize: 13, color: '#5a6b61', lineHeight: 19 },
});
