import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

type CoalCreekHeaderProps = {
  logoHeight?: number;
  compact?: boolean;
};

export function CoalCreekHeader({ logoHeight = 76, compact = true }: CoalCreekHeaderProps) {
  return (
    <>
      <View style={[styles.header, compact ? styles.headerCompact : null]}>
        <Image
          source={require('@/assets/images/coal-creek-logo-full.png')}
          style={[styles.logo, { height: logoHeight }]}
          resizeMode="contain"
        />
      </View>
      <View style={styles.accent} />
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    width: '100%',
    backgroundColor: '#18341d',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 18,
  },
  headerCompact: {
    minHeight: 130,
  },
  logo: {
    width: '100%',
    maxWidth: 220,
    opacity: 1,
  },
  accent: {
    width: '100%',
    height: 3,
    backgroundColor: '#6f8a57',
  },
});
