
import React from 'react';
import { StyleSheet, View, ViewProps } from 'react-native';

export function SectionCard(props: ViewProps) {
  return <View {...props} style={[styles.card, props.style]} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fffdf8',
    borderWidth: 1,
    borderColor: 'rgba(24,52,29,0.08)',
    borderRadius: 18,
    padding: 16,
    shadowColor: '#132117',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
});
