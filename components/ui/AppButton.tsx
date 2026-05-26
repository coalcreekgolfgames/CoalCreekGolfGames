
import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';

type Props = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function AppButton({ title, onPress, disabled, variant = 'primary', compact = false, style }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        compact ? styles.compactBase : undefined,
        styles[variant],
        pressed && !disabled ? styles.pressed : undefined,
        disabled ? styles.disabled : undefined,
        style,
      ]}
    >
      <Text
        numberOfLines={2}
        ellipsizeMode="tail"
        style={[styles.text, compact ? styles.compactText : undefined, variant === 'primary' ? styles.primaryText : styles.secondaryText]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    minWidth: 132,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  compactBase: { minHeight: 44, minWidth: 0, paddingHorizontal: 12, paddingVertical: 10 },
  primary: { backgroundColor: '#18341d' },
  secondary: { backgroundColor: '#fffdf8', borderWidth: 1, borderColor: '#d8d1c4' },
  ghost: { backgroundColor: '#eef3ec' },
  text: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
    textAlign: 'center',
    includeFontPadding: false,
  },
  compactText: { fontSize: 15, lineHeight: 18 },
  primaryText: { color: '#fff' },
  secondaryText: { color: '#132117' },
  pressed: { opacity: 0.9 },
  disabled: { opacity: 0.5 },
});
