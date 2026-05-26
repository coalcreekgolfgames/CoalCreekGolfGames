import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, router } from 'expo-router';
import { CoalCreekHeader } from '@/components/CoalCreekHeader';
import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { useAuth } from '@/providers/AuthProvider';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    try {
      setLoading(true);
      await signIn(email.trim(), password);
      router.replace('/(tabs)/home');
    } catch (error: any) {
      Alert.alert('Login failed', error?.message ?? 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      <View style={styles.shell}>
        <CoalCreekHeader logoHeight={72} compact />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.hero}>
            <Text style={styles.heroTitle}>Shared Scoring Portal</Text>
            <Text style={styles.heroText}>Rounds, Games, Tournaments, Stats, and Handicap Tracking.</Text>
          </View>

          <View style={styles.card}>
            <AppInput
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <AppInput
              label="Password"
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              secureTextEntry
            />
            <AppButton title={loading ? 'Signing in...' : 'Log In'} onPress={handleLogin} disabled={loading} />
            <Link href="/(auth)/forgot-password" style={styles.link}>
              Forgot password?
            </Link>
          </View>

          <Link href="/(auth)/signup" style={styles.createAccountLink}>
            Create account
          </Link>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f5ee' },
  shell: { flex: 1, backgroundColor: '#f8f5ee' },
  content: { padding: 20, gap: 18, justifyContent: 'center', flexGrow: 1 },
  hero: {
    backgroundColor: '#18341d',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 22,
    shadowColor: '#132117',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  heroTitle: { color: '#fffdf8', fontSize: 28, lineHeight: 32, fontWeight: '800', marginTop: 6 },
  heroText: { color: 'rgba(255,253,248,0.9)', marginTop: 10, fontSize: 15, lineHeight: 22 },
  card: {
    backgroundColor: '#fffdf8',
    borderRadius: 22,
    padding: 18,
    gap: 16,
    borderWidth: 1,
    borderColor: 'rgba(24, 52, 29, 0.08)',
  },
  link: { color: '#18341d', fontWeight: '700' },
  createAccountLink: { color: '#18341d', fontWeight: '700', textAlign: 'center' },
});
