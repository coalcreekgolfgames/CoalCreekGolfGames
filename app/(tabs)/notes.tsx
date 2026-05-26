import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SectionCard } from '@/components/ui/SectionCard';

export default function NotesScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Notes</Text>

      <SectionCard>
        <Text style={styles.sectionTitle}>Separate notes area</Text>
        <Text style={styles.body}>
          Notes are no longer part of the live round wizard flow. This screen is the placeholder destination in More for future round notes, course notes, and personal reminders.
        </Text>
      </SectionCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f0e7' },
  content: { padding: 16, gap: 16 },
  title: { fontSize: 28, fontWeight: '800', color: '#132117' },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: '#132117', marginBottom: 8 },
  body: { fontSize: 15, color: '#5a6b61', lineHeight: 22 },
});
