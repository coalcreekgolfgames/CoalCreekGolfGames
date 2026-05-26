import { Redirect, Tabs } from 'expo-router';
import { useAuth } from '@/providers/AuthProvider';
import { PlayerBottomNav } from '@/components/navigation/PlayerBottomNav';

export default function TabsLayout() {
  const { session, loading } = useAuth();
  if (!loading && !session) return <Redirect href="/(auth)/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
      }}
      tabBar={(props) => <PlayerBottomNav {...props} />}
    >
      <Tabs.Screen name="home" options={{ title: 'Home' }} />
      <Tabs.Screen name="round" options={{ title: 'Live Round', href: null }} />
      <Tabs.Screen name="tournaments" options={{ title: 'Tournaments', href: null }} />
      <Tabs.Screen name="golf-canada" options={{ title: 'Golf Canada', href: null }} />
      <Tabs.Screen name="history" options={{ title: 'History', href: null }} />
      <Tabs.Screen name="notes" options={{ title: 'Notes', href: null }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', href: null }} />
      <Tabs.Screen name="help" options={{ title: 'Help', href: null }} />
      <Tabs.Screen name="stats" options={{ title: 'Stats', href: null }} />
    </Tabs>
  );
}
