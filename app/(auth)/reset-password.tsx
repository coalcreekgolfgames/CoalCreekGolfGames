import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { Link, router } from 'expo-router';
import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { useAuth } from '@/providers/AuthProvider';

export default function ResetPasswordScreen() {
  const { passwordRecoveryMode, updatePassword, completePasswordRecovery, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const unavailableMessage = useMemo(() => (
    passwordRecoveryMode
      ? null
      : 'Open the password reset link from your email to continue.'
  ), [passwordRecoveryMode]);

  const handleSave = async () => {
    if (!password.trim()) {
      setErrorMessage('Enter a new password.');
      return;
    }
    if (password.length < 6) {
      setErrorMessage('Your new password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('Your passwords do not match.');
      return;
    }

    try {
      setLoading(true);
      setErrorMessage(null);
      await updatePassword(password);
      completePasswordRecovery();
      await signOut().catch(() => undefined);
      setSuccessMessage('Your password was updated. Log in with your new password.');
      setPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        router.replace('/(auth)/login');
      }, 1200);
    } catch {
      setSuccessMessage(null);
      setErrorMessage('We couldn’t update your password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Reset password</Text>
        <Text style={styles.subtitle}>
          {unavailableMessage ?? 'Enter a new password for your account.'}
        </Text>
        <AppInput
          label="New password"
          value={password}
          onChangeText={setPassword}
          autoCapitalize="none"
          secureTextEntry
        />
        <AppInput
          label="Confirm password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          autoCapitalize="none"
          secureTextEntry
        />
        {successMessage ? <Text style={styles.success}>{successMessage}</Text> : null}
        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
        <AppButton
          title={loading ? 'Saving...' : 'Save New Password'}
          onPress={handleSave}
          disabled={loading || !passwordRecoveryMode}
        />
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
