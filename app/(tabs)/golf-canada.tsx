
import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SectionCard } from '@/components/ui/SectionCard';

export default function GolfCanadaScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Golf Canada</Text>
      <SectionCard>
        <Text style={styles.sectionTitle}>Separate workflow</Text>
        <Text style={styles.subtitle}>This stays separate from Home and Live Round, matching the current Yardage Book. Later we can wire a posting draft from completed rounds and a one-tap handoff into Score Centre.</Text>
      </SectionCard>
      <SectionCard>
        <Text style={styles.sectionTitle}>Planned handoff</Text>
        <Text style={styles.subtitle}>• Pull completed round totals</Text>
        <Text style={styles.subtitle}>• Build posting draft</Text>
        <Text style={styles.subtitle}>• Copy summary and scores</Text>
      </SectionCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f0e7' },
  content: { padding: 16, gap: 16 },
  title: { fontSize: 28, fontWeight: '800', color: '#132117' },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: '#132117', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#5a6b61', lineHeight: 22 },
});
