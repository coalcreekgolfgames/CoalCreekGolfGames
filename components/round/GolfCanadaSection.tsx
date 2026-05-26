import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppButton } from '@/components/ui/AppButton';
import { SectionCard } from '@/components/ui/SectionCard';
import {
  golfCanadaPostedAtLabel,
  golfCanadaPostingStatusLabel,
  golfCanadaPostingStatusTone,
} from '@/lib/golfCanada';
import type { GolfCanadaPostingPrep } from '@/lib/golfCanada';
import type { GolfCanadaPostingRecord } from '@/types/round';

type Props = {
  postingState?: GolfCanadaPostingRecord | null;
  prep?: GolfCanadaPostingPrep | null;
  description: string;
  unavailableText?: string;
  onPost: () => void;
  onMarkPosted?: (() => void) | null;
  postingBusy?: boolean;
};

export function GolfCanadaSection({
  postingState,
  prep,
  description,
  unavailableText = 'No completed score is available for your account on this round.',
  onPost,
  onMarkPosted,
  postingBusy = false,
}: Props) {
  const tone = golfCanadaPostingStatusTone(postingState);
  const postedAtLabel = golfCanadaPostedAtLabel(postingState);
  const isPosted = tone === 'posted';

  return (
    <SectionCard>
      <Text style={styles.sectionTitle}>Golf Canada</Text>
      <View style={[styles.statusPill, isPosted ? styles.statusPillPosted : styles.statusPillPending]}>
        <Text style={styles.statusPillText}>{golfCanadaPostingStatusLabel(postingState)}</Text>
      </View>
      {postedAtLabel ? <Text style={styles.body}>{postedAtLabel}</Text> : null}
      {prep ? (
        <>
          <Text style={styles.body}>{description}</Text>
          <AppButton title="Post to Golf Canada" onPress={onPost} variant="secondary" />
          {!isPosted && onMarkPosted ? (
            <AppButton
              title={postingBusy ? 'Marking Posted...' : 'Mark Posted'}
              onPress={onMarkPosted}
              variant="ghost"
              disabled={postingBusy}
            />
          ) : null}
        </>
      ) : (
        <Text style={styles.body}>{unavailableText}</Text>
      )}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 18, fontWeight: '800', color: '#132117', marginBottom: 8 },
  body: { fontSize: 14, color: '#5a6b61', lineHeight: 21 },
  statusPill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 10 },
  statusPillPending: { backgroundColor: '#efe7d5' },
  statusPillPosted: { backgroundColor: '#e7efe8' },
  statusPillText: { fontSize: 13, color: '#18341d', fontWeight: '800' },
});
