import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { useAuth } from '@/providers/AuthProvider';

export default function ForgotPasswordScreen() {
  const { sendPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSend = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setSuccess(false);
      setErrorMessage('Enter the email address on your account.');
      return;
    }

    try {
      setLoading(true);
      setErrorMessage(null);
      await sendPasswordReset(normalizedEmail);
      setSuccess(true);
    } catch {
      setSuccess(false);
      setErrorMessage('We couldn’t send the reset email. Please check the email address and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Forgot password</Text>
        <Text style={styles.subtitle}>We&apos;ll send a reset link to the email on your account.</Text>
        <AppInput
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        {success ? <Text style={styles.success}>Check your email for a password reset link.</Text> : null}
        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
        <AppButton title={loading ? 'Sending...' : 'Send Reset Link'} onPress={handleSend} disabled={loading} />
        <Link href="/(auth)/login" style={styles.link}>Back to login</Link>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f0e7' },
  content: { padding: 20, gap: 16, justifyContent: 'center', flex: 1 },
  title: { fontSize: 30, fontWeight: '800', color: '#132117' },
  subtitle: { color: '#5a6b61', fontSize: 15, lineHeight: 22 },
  success: { color: '#18341d', fontSize: 14, lineHeight: 20, fontWeight: '700' },
  error: { color: '#8a2f2b', fontSize: 14, lineHeight: 20 },
  link: { color: '#18341d', fontWeight: '700' },
});
