
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

type Props = {
  title: string;
  subtitle?: string;
  badge?: string;
};

export function RoundHeader({ title, subtitle, badge }: Props) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {badge ? <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  title: { fontSize: 28, fontWeight: '800', color: '#132117' },
  subtitle: { fontSize: 15, color: '#5a6b61', marginTop: 4 },
  badge: { backgroundColor: '#eef3ec', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  badgeText: { color: '#18341d', fontWeight: '700', fontSize: 12 },
});
