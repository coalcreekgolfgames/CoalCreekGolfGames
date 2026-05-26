import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatCurrencyFromCents } from '@/lib/currency';
import type { GameSettlement } from '@/lib/settlements';

type Props = {
  settlement: GameSettlement | null;
  unitLabel: string;
  pendingText?: string | null;
  emptyText?: string | null;
  unitValueCents?: number | null;
};

export function SettlementBreakdown({ settlement, unitLabel, pendingText, emptyText, unitValueCents }: Props) {
  if (!settlement) {
    const text = pendingText ?? emptyText ?? null;
    return text ? <Text style={styles.body}>{text}</Text> : null;
  }

  const displayedUnitValueCents = unitValueCents ?? settlement.unitValueCents;

  return (
    <View style={styles.wrap}>
      <Text style={styles.body}>Buy-in per player: {formatCurrencyFromCents(settlement.buyInCents)}</Text>
      <Text style={styles.body}>Total pot: {formatCurrencyFromCents(settlement.totalPotCents)}</Text>
      <Text style={styles.body}>
        {unitLabel} value: {displayedUnitValueCents === null ? '-' : formatCurrencyFromCents(displayedUnitValueCents)}
      </Text>
      <View style={styles.list}>
        {settlement.players.map((player) => (
          <Text key={player.id} style={styles.meta}>
            {player.displayName}: winnings {formatCurrencyFromCents(player.grossWinningsCents)} · net {formatCurrencyFromCents(player.netCents)}
          </Text>
        ))}
      </View>
      <View style={styles.list}>
        <Text style={styles.label}>Who pays whom</Text>
        {settlement.settlements.length > 0 ? (
          settlement.settlements.map((transfer) => (
            <Text key={`${transfer.fromParticipantId}-${transfer.toParticipantId}`} style={styles.meta}>
              {transfer.fromDisplayName} pays {transfer.toDisplayName} {formatCurrencyFromCents(transfer.amountCents)}
            </Text>
          ))
        ) : (
          <Text style={styles.meta}>No settlement is needed.</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6, marginTop: 10 },
  body: { fontSize: 14, color: '#5a6b61', lineHeight: 21 },
  list: { gap: 4, marginTop: 4 },
  label: { fontSize: 13, color: '#132117', fontWeight: '800' },
  meta: { fontSize: 13, color: '#5a6b61', lineHeight: 19 },
});
