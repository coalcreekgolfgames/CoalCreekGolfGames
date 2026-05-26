
import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { useAuth } from '@/providers/AuthProvider';

export default function SignupScreen() {
  const { signUp } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSignup = async () => {
    if (!password.trim()) {
      setPasswordError('Enter a password.');
      return;
    }
    if (!confirmPassword.trim()) {
      setPasswordError('Confirm your password.');
      return;
    }
    if (password.length < 6) {
      setPasswordError('Your password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }

    try {
      setLoading(true);
      setPasswordError(null);
      await signUp({ firstName, lastName, email: email.trim().toLowerCase(), password });
      Alert.alert('Account created', 'If email confirmation is enabled, check your inbox before logging in.');
    } catch (error: any) {
      Alert.alert('Sign up failed', error?.message ?? 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Create account</Text>
        <View style={styles.card}>
          <AppInput label="First name" value={firstName} onChangeText={setFirstName} />
          <AppInput label="Last name" value={lastName} onChangeText={setLastName} />
          <AppInput label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          <AppInput
            label="Password"
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              if (passwordError) setPasswordError(null);
            }}
            autoCapitalize="none"
            secureTextEntry
            error={passwordError ?? undefined}
          />
          <AppInput
            label="Confirm password"
            value={confirmPassword}
            onChangeText={(value) => {
              setConfirmPassword(value);
              if (passwordError) setPasswordError(null);
            }}
            autoCapitalize="none"
            secureTextEntry
            error={passwordError ?? undefined}
          />
          <AppButton title={loading ? 'Creating...' : 'Create account'} onPress={handleSignup} disabled={loading} />
        </View>
        <Link href="/(auth)/login" style={styles.link}>Already have an account?</Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f0e7' },
  content: { padding: 20, gap: 20, justifyContent: 'center', flexGrow: 1 },
  title: { fontSize: 30, fontWeight: '800', color: '#132117' },
  card: { backgroundColor: '#fffdf8', borderRadius: 18, padding: 18, gap: 16 },
  link: { color: '#18341d', fontWeight: '700', textAlign: 'center' },
});
