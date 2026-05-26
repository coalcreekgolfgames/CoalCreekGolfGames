import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BrandedScreen } from '@/components/BrandedScreen';
import { SectionCard } from '@/components/ui/SectionCard';

type SectionProps = {
  title: string;
  children: React.ReactNode;
};

function HelpSection({ title, children }: SectionProps) {
  return (
    <SectionCard style={styles.card}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </SectionCard>
  );
}

function BodyText({ children, strong = false }: { children: React.ReactNode; strong?: boolean }) {
  return <Text style={[styles.body, strong ? styles.bodyStrong : null]}>{children}</Text>;
}

export default function HelpScreen() {
  return (
    <BrandedScreen
      title="Help & Game Guide"
      subtitle="Quick guidance for the main app features, live scoring flow, history, Golf Canada, and side games."
      screenName="help"
      showWatermark={false}
    >
      <HelpSection title="Getting Started">
        <BodyText>
          Coal Creek helps you keep live scores, track round stats, play side games, review your history, and prepare your score for Golf Canada.
        </BodyText>
      </HelpSection>

      <HelpSection title="Home Screen">
        <BodyText strong>Start from the Home screen:</BodyText>
        <BodyText>• Live Round starts or resumes a solo live round.</BodyText>
        <BodyText>• Group Round starts or resumes a group round.</BodyText>
        <BodyText>• History shows completed saved rounds.</BodyText>
        <BodyText>• Tournaments opens tournament rounds and leaderboards.</BodyText>
        <BodyText>• Course Yardage lets you review tee boxes and yardages.</BodyText>
      </HelpSection>

      <HelpSection title="Live Rounds">
        <BodyText>Use Live Round when you want to score a round as you play.</BodyText>
        <BodyText strong>Typical flow:</BodyText>
        <BodyText>1. Start or resume a live round.</BodyText>
        <BodyText>2. Answer stat questions when they appear.</BodyText>
        <BodyText>3. Enter scores using the compact score controls.</BodyText>
        <BodyText>4. Save the hole.</BodyText>
        <BodyText>5. Move to the next hole.</BodyText>
        <BodyText>6. Finish the round and review it in History.</BodyText>
        <BodyText>If stats are enabled, the app asks stat questions first, then shows score entry.</BodyText>
      </HelpSection>

      <HelpSection title="Group Rounds">
        <BodyText>Use Group Round when multiple players are playing together.</BodyText>
        <BodyText>
          The scorekeeper can enter official scores for the group. Registered participants can also follow along, enter their own score or stats, and view the Live Board when the round is active.
        </BodyText>
        <BodyText>Group round History shows the players, totals, and Hole by Hole scores.</BodyText>
      </HelpSection>

      <HelpSection title="Live Board">
        <BodyText>
          Live Board is available during active live rounds and games. It shows the current round or game standings while the round is in progress.
        </BodyText>
        <BodyText>Live Board is only shown during active rounds. It is not a global menu option.</BodyText>
      </HelpSection>

      <HelpSection title="History">
        <BodyText>History shows completed saved rounds with real score data.</BodyText>
        <BodyText strong>Open a round to view:</BodyText>
        <BodyText>• score summary</BodyText>
        <BodyText>• player totals</BodyText>
        <BodyText>• Hole by Hole scores</BodyText>
        <BodyText>• game results when a game was played</BodyText>
        <BodyText>• Golf Canada option when available</BodyText>
        <BodyText>Draft, cancelled, unfinished, or zero-score rounds should not appear in History.</BodyText>
      </HelpSection>

      <HelpSection title="Golf Canada">
        <BodyText>
          Golf Canada posting is available from valid completed round detail screens when your score is ready to post.
        </BodyText>
        <BodyText>
          The app prepares your hole-by-hole score information so you can copy it and post manually through Golf Canada.
        </BodyText>
        <BodyText>Golf Canada is not in the More menu.</BodyText>
      </HelpSection>

      <HelpSection title="Course Yardage">
        <BodyText>
          Course Yardage shows Coal Creek tee boxes, total yardage, par, rating and slope when available, and hole-by-hole yardages.
        </BodyText>
        <BodyText>
          Tap the Course Yardage card on Home to choose a tee box and review the course information.
        </BodyText>
      </HelpSection>

      <HelpSection title="Games">
        <Text style={styles.gameTitle}>Stableford</Text>
        <BodyText>Stableford is a points-based scoring game.</BodyText>
        <BodyText>
          Instead of only counting total strokes, each hole earns points based on the result for that hole. Higher points are better.
        </BodyText>
        <BodyText>
          Use Stableford when you want a game format that rewards good holes and keeps players engaged even after one bad hole.
        </BodyText>

        <Text style={styles.gameTitle}>Bingo Bango Bongo</Text>
        <BodyText>Bingo Bango Bongo is a three-point game on each hole.</BodyText>
        <BodyText>• Bingo: first player to reach the green.</BodyText>
        <BodyText>• Bango: player closest to the hole once all players are on the green.</BodyText>
        <BodyText>• Bongo: first player to hole out.</BodyText>
        <BodyText>
          The app tracks the winners and totals through the round. If there is a buy-in, the app can show settlement and payout information at the end.
        </BodyText>

        <Text style={styles.gameTitle}>Skins</Text>
        <BodyText>Skins is a hole-by-hole game.</BodyText>
        <BodyText>• A single unique low score wins the skin.</BodyText>
        <BodyText>• If the low score is tied, the skin pushes.</BodyText>
        <BodyText>• Pushed skins carry over to the next hole.</BodyText>
        <BodyText>• A later hole can be worth multiple skins if carryovers build up.</BodyText>
        <BodyText>
          At the end of the round, the app shows the skins results and settlement or payout information when a buy-in was used.
        </BodyText>
        <BodyText>House rule: if skins are still unresolved after the final hole, use a putt-off to decide the final carryover winner.</BodyText>

        <Text style={styles.gameTitle}>Nassau</Text>
        <BodyText>
          Nassau is a three-part scoring game made up of the Front 9, Back 9, and Overall 18.
        </BodyText>
        <BodyText>
          Players who buy in compete individually. The lowest total score wins each segment.
        </BodyText>
        <BodyText>
          If players tie for a segment, they share that segment. Presses are not included in v1.
        </BodyText>
      </HelpSection>
    </BrandedScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#f8f5ee',
    borderColor: 'rgba(24,52,29,0.1)',
    shadowOpacity: 0.05,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#132117',
    marginBottom: 10,
  },
  sectionBody: {
    gap: 8,
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
    color: '#4f5f55',
  },
  bodyStrong: {
    color: '#18341d',
    fontWeight: '700',
  },
  gameTitle: {
    marginTop: 8,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
    color: '#18341d',
  },
});
