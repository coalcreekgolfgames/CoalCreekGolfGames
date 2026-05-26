import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  ImageBackground,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';

type RoundHeroActionCardProps = {
  title: string;
  subtitle: string;
  imageSource: ImageSourcePropType;
  onPress?: (() => void) | null;
  testID?: string;
  disabled?: boolean;
  showArrow?: boolean;
};

export function RoundHeroActionCard({
  title,
  subtitle,
  imageSource,
  onPress,
  testID,
  disabled = false,
  showArrow,
}: RoundHeroActionCardProps) {
  const interactive = typeof onPress === 'function' && !disabled;
  const shouldShowArrow = showArrow ?? interactive;

  const content = (
    <ImageBackground source={imageSource} imageStyle={styles.image} style={styles.card}>
      <LinearGradient
        colors={['rgba(7,16,10,0.10)', 'rgba(14,35,18,0.44)', 'rgba(19,33,23,0.92)']}
        locations={[0, 0.48, 1]}
        style={styles.overlay}
      />
      <View style={styles.content}>
        <View style={styles.textWrap}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        {shouldShowArrow ? (
          <View style={styles.actionButton}>
            <MaterialIcons name="arrow-forward" size={22} color="#18341d" />
          </View>
        ) : null}
      </View>
    </ImageBackground>
  );

  if (!interactive) {
    return (
      <View
        style={[styles.shadowWrap, disabled ? styles.shadowWrapDisabled : null]}
        testID={testID}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.shadowWrap,
        pressed ? styles.shadowWrapPressed : null,
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shadowWrap: {
    borderRadius: 28,
    shadowColor: '#102014',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.16,
    shadowRadius: 22,
    elevation: 7,
  },
  shadowWrapPressed: {
    opacity: 0.94,
    transform: [{ scale: 0.995 }],
  },
  shadowWrapDisabled: {
    opacity: 0.7,
  },
  card: {
    minHeight: 178,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    borderRadius: 28,
    backgroundColor: '#18341d',
  },
  image: {
    borderRadius: 28,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  content: {
    minHeight: 178,
    paddingHorizontal: 22,
    paddingVertical: 22,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 16,
  },
  textWrap: {
    flex: 1,
    gap: 6,
  },
  title: {
    color: '#fffdf8',
    fontSize: 28,
    lineHeight: 31,
    fontWeight: '800',
  },
  subtitle: {
    color: 'rgba(255,253,248,0.9)',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
    maxWidth: 220,
  },
  actionButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff7ec',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
