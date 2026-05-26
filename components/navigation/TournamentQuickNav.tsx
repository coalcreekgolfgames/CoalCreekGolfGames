import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const MORE_ITEMS = [
  { label: 'Tournaments', route: '/(tabs)/tournaments' },
  { label: 'Live Round', route: '/(tabs)/round' },
  { label: 'Profile', route: '/(tabs)/profile' },
  { label: 'Help', route: '/(tabs)/help' },
];

export function TournamentQuickNav() {
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);

  return (
    <>
      <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <View style={styles.bar}>
          <Pressable onPress={() => router.replace('/(tabs)/home')} style={({ pressed }) => [styles.button, pressed ? styles.pressed : undefined]}>
            <Text style={styles.buttonLabel}>Home</Text>
          </Pressable>
          <Pressable onPress={() => setVisible(true)} style={({ pressed }) => [styles.button, pressed ? styles.pressed : undefined]}>
            <Text style={styles.buttonLabel}>More</Text>
          </Pressable>
        </View>
      </View>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <Pressable style={styles.backdrop} onPress={() => setVisible(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>More</Text>
            {MORE_ITEMS.map((item) => (
              <Pressable
                key={item.route}
                onPress={() => {
                  setVisible(false);
                  router.push(item.route as any);
                }}
                style={({ pressed }) => [styles.sheetRow, pressed ? styles.pressed : undefined]}
              >
                <Text style={styles.sheetLabel}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: 'rgba(244,240,231,0.96)',
    borderTopWidth: 1,
    borderTopColor: '#d9d1c3',
  },
  bar: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    minHeight: 52,
    borderRadius: 18,
    backgroundColor: '#fffdf8',
    borderWidth: 1,
    borderColor: '#d9d1c3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: '#18341d',
  },
  pressed: {
    opacity: 0.88,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(7,10,8,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 24,
    backgroundColor: '#18341d',
    padding: 18,
    gap: 10,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fffdf8',
    marginBottom: 6,
  },
  sheetRow: {
    borderRadius: 16,
    backgroundColor: '#fffdf8',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  sheetLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: '#18341d',
  },
});
