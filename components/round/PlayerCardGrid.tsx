import React from 'react';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

type PlayerCardGridProps = {
  children: React.ReactNode;
  style?: ViewStyle;
};

type PlayerCardProps = {
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  selected?: boolean;
  disabled?: boolean;
  placeholder?: boolean;
  onPress?: () => void;
  children?: React.ReactNode;
  style?: ViewStyle;
  titleStyle?: TextStyle;
  subtitleStyle?: TextStyle;
  metaStyle?: TextStyle;
  bodyStyle?: ViewStyle;
};

export function PlayerCardGrid({ children, style }: PlayerCardGridProps) {
  return <View style={[styles.grid, style]}>{children}</View>;
}

export function PlayerCard({
  title,
  subtitle,
  meta,
  selected = false,
  disabled = false,
  placeholder = false,
  onPress,
  children,
  style,
  titleStyle,
  subtitleStyle,
  metaStyle,
  bodyStyle,
}: PlayerCardProps) {
  const content = (
    <>
      <Text style={[styles.title, titleStyle]}>{title}</Text>
      {subtitle ? <Text style={[styles.subtitle, subtitleStyle]}>{subtitle}</Text> : null}
      {meta ? <Text style={[styles.meta, metaStyle]}>{meta}</Text> : null}
      {children ? <View style={[styles.body, bodyStyle]}>{children}</View> : null}
    </>
  );

  const baseStyle = [
    styles.card,
    selected ? styles.cardSelected : undefined,
    placeholder ? styles.cardPlaceholder : undefined,
    disabled ? styles.cardDisabled : undefined,
    style,
  ];

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => [
          ...baseStyle,
          pressed && !disabled ? styles.cardPressed : undefined,
        ]}
      >
        {content}
      </Pressable>
    );
  }

  return <View style={baseStyle}>{content}</View>;
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  card: {
    width: '48%',
    minHeight: 118,
    borderRadius: 18,
    padding: 12,
    backgroundColor: '#f8f5ee',
    borderWidth: 1,
    borderColor: '#e1d9ca',
    justifyContent: 'space-between',
    gap: 6,
  },
  cardSelected: {
    borderColor: '#18341d',
    backgroundColor: '#eef3ec',
  },
  cardPlaceholder: {
    backgroundColor: '#fbf8f1',
    borderStyle: 'dashed',
  },
  cardDisabled: {
    opacity: 0.65,
  },
  cardPressed: {
    opacity: 0.92,
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
    color: '#132117',
  },
  subtitle: {
    fontSize: 13,
    color: '#5a6b61',
  },
  meta: {
    fontSize: 12,
    color: '#5a6b61',
  },
  body: {
    gap: 8,
    marginTop: 4,
  },
});
