import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatCurrencyFromCents } from '@/lib/currency';
import { formatWolfPoints, type WolfSettlement } from '@/lib/wolf';

type Props = {
  settlement: WolfSettlement | null;
  pendingText?: string | null;
  emptyText?: string | null;
  unavailableText?: string | null;
};

export function WolfSettlementBreakdown({ settlement, pendingText, emptyText, unavailableText }: Props) {
  if (!settlement) {
    const text = pendingText ?? emptyText ?? unavailableText ?? null;
    return text ? <Text style={styles.body}>{text}</Text> : null;
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.body}>Buy-in per player: {formatCurrencyFromCents(settlement.buyInCents)}</Text>
      <Text style={styles.body}>Pot: {formatCurrencyFromCents(settlement.totalPotCents)}</Text>
      <Text style={styles.body}>Pot split by Wolf points.</Text>
      <Text style={styles.body}>
        {settlement.usedEvenSplitFallback
          ? 'No positive final points. Pot split evenly.'
          : 'Payouts are proportional to final positive points.'}
      </Text>
      <Text style={styles.body}>Max loss is the buy-in.</Text>
      <View style={styles.list}>
        {settlement.players.map((player) => (
          <Text key={player.participantId} style={styles.meta}>
            {player.displayName}: {formatWolfPoints(player.finalPoints)} total,
            {' '}
            eligible {player.eligiblePoints},
            {' '}
            winnings {formatCurrencyFromCents(player.grossWinningsCents)},
            {' '}
            {player.netCents > 0 ? `net +${formatCurrencyFromCents(player.netCents)}` : player.netCents < 0 ? `net -${formatCurrencyFromCents(Math.abs(player.netCents))}` : 'net $0.00'}
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
