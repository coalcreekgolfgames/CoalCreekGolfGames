
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppButton } from '@/components/ui/AppButton';

type Props = {
  label: string;
  value: boolean | null | undefined;
  onYes: () => void;
  onNo: () => void;
};

export function ChoiceRow({ label, value, onYes, onNo }: Props) {
  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <AppButton title="Yes" onPress={onYes} variant={value === true ? 'primary' : 'secondary'} style={styles.button} />
        <AppButton title="No" onPress={onNo} variant={value === false ? 'primary' : 'secondary'} style={styles.button} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 8 },
  label: { fontSize: 15, fontWeight: '700', color: '#132117' },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  button: { flexGrow: 1, flexBasis: 140, minWidth: 140 },
});
