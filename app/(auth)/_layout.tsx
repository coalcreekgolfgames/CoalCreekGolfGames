import { Redirect, Stack, usePathname, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useAuth } from '@/providers/AuthProvider';

export default function AuthLayout() {
  const { session, loading, passwordRecoveryMode } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!passwordRecoveryMode) return;
    if (pathname === '/reset-password') return;
    router.replace('/(auth)/reset-password');
  }, [passwordRecoveryMode, pathname, router]);

  if (!loading && session && !passwordRecoveryMode) {
    return <Redirect href="/(tabs)/home" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
