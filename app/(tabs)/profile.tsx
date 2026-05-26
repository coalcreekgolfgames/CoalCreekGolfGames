
import React from 'react';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';
import { AppButton } from '@/components/ui/AppButton';
import { SectionCard } from '@/components/ui/SectionCard';
import { useAuth } from '@/providers/AuthProvider';

export default function ProfileScreen() {
  const { profile, signOut } = useAuth();

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error: any) {
      Alert.alert('Sign out failed', error?.message ?? 'Please try again.');
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Profile</Text>
      <SectionCard>
        <Text style={styles.name}>{profile?.first_name} {profile?.last_name}</Text>
        <Text style={styles.email}>{profile?.email}</Text>
      </SectionCard>
      <SectionCard>
        <Text style={styles.subtitle}>This shared account will power tournament mode, round history, and the admin portal access check.</Text>
      </SectionCard>
      <AppButton title="Log out" onPress={handleSignOut} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f0e7' },
  content: { padding: 16, gap: 16 },
  title: { fontSize: 28, fontWeight: '800', color: '#132117' },
  name: { fontSize: 24, fontWeight: '800', color: '#132117' },
  email: { fontSize: 15, color: '#5a6b61', marginTop: 6 },
  subtitle: { fontSize: 15, color: '#5a6b61', lineHeight: 22 },
});
