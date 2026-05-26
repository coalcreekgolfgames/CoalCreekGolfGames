
import React from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';

type Props = TextInputProps & { label: string; error?: string };

export function AppInput({ label, error, ...props }: Props) {
  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor="#728277" style={[styles.input, error ? styles.inputError : undefined]} {...props} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 8 },
  label: { fontSize: 14, fontWeight: '700', color: '#132117' },
  input: { minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: '#d8d1c4', backgroundColor: '#fffdf8', paddingHorizontal: 14, fontSize: 16, color: '#132117' },
  inputError: { borderColor: '#a63030' },
  error: { color: '#a63030', fontSize: 12 },
});
