import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { AppButton } from '@/components/ui/AppButton';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';

function RootNavigator() {
  const { loading, session, authError, retryAuthBootstrap } = useAuth();
  const showBlockingBootstrap = loading && !session;

  if (showBlockingBootstrap) {
    return (
      <View style={styles.loadingScreen}>
        <Image
          source={require('@/assets/images/coal-creek-logo-watermark.png')}
          style={styles.watermark}
          resizeMode="contain"
        />
        <View style={styles.loadingCard}>
          <Image
            source={require('@/assets/images/coal-creek-logo-full.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <ActivityIndicator size="small" color="#18341d" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.stackContainer}>
      <Stack screenOptions={{ headerShown: false }} />
      {session && authError ? (
        <View pointerEvents="box-none" style={styles.bannerShell}>
          <View style={styles.bannerCard}>
            <Text style={styles.bannerTitle}>Offline mode / reconnecting</Text>
            <Text style={styles.bannerText}>{authError}</Text>
            <AppButton title="Retry" onPress={() => void retryAuthBootstrap()} compact />
          </View>
        </View>
      ) : null}
    </View>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <RootNavigator />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  stackContainer: {
    flex: 1,
  },
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f4f0e7',
    overflow: 'hidden',
  },
  watermark: {
    position: 'absolute',
    width: '120%',
    height: '120%',
    opacity: 0.08,
  },
  loadingCard: {
    width: '84%',
    maxWidth: 420,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    paddingHorizontal: 24,
    paddingVertical: 28,
    borderRadius: 24,
    backgroundColor: 'rgba(244, 240, 231, 0.94)',
  },
  logo: {
    width: '100%',
    height: 120,
  },
  bannerShell: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
  },
  bannerCard: {
    gap: 12,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(255, 253, 248, 0.98)',
    borderWidth: 1,
    borderColor: '#d8d1c4',
  },
  bannerTitle: {
    color: '#132117',
    fontSize: 16,
    fontWeight: '800',
  },
  bannerText: {
    color: '#314236',
    fontSize: 14,
    lineHeight: 20,
  },
});
