
import { Redirect } from 'expo-router';
import { useAuth } from '@/providers/AuthProvider';

export default function IndexScreen() {
  const { session } = useAuth();
  return <Redirect href={session ? '/(tabs)/home' : '/(auth)/login'} />;
}
