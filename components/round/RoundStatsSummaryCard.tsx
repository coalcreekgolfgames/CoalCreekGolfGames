import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

type RoundStatsSummaryCardProps = {
  lastRoundScore?: number | null;
  lastRoundToPar?: number | null;
  handicap?: number | null;
  roundsThisSeason?: number | null;
};

function formatToPar(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '(--)';
  if (value === 0) return '(E)';
  return value > 0 ? `(+${value})` : `(${value})`;
}

function formatHandicap(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toFixed(1);
}

function formatRounds(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '0';
  return String(Math.round(value));
}

type StatColumnProps = {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  label: string;
  value: string;
  helper?: string;
  showDivider?: boolean;
};

function StatColumn({ icon, label, value, helper, showDivider = false }: StatColumnProps) {
  return (
    <View style={styles.columnWrap}>
      {showDivider ? <View style={styles.divider} /> : null}
      <View style={styles.column}>
        <View style={styles.iconBubble}>
          <MaterialIcons name={icon} size={18} color="#fffdf8" />
        </View>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{value}</Text>
        {helper ? <Text style={styles.helper}>{helper}</Text> : null}
      </View>
    </View>
  );
}

export function RoundStatsSummaryCard({
  lastRoundScore,
  lastRoundToPar,
  handicap,
  roundsThisSeason,
}: RoundStatsSummaryCardProps) {
  return (
    <View style={styles.card}>
      <StatColumn
        icon="flag"
        label="Last Round"
        value={typeof lastRoundScore === 'number' && Number.isFinite(lastRoundScore) ? String(lastRoundScore) : '—'}
        helper={formatToPar(lastRoundToPar)}
      />
      <StatColumn
        icon="show-chart"
        label="Handicap"
        value={formatHandicap(handicap)}
        showDivider
      />
      <StatColumn
        icon="event-note"
        label="Rounds"
        value={formatRounds(roundsThisSeason)}
        helper="This Season"
        showDivider
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderRadius: 24,
    backgroundColor: '#fffdf8',
    paddingVertical: 18,
    shadowColor: '#102014',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 5,
  },
  columnWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  column: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    gap: 5,
    minHeight: 110,
  },
  divider: {
    width: 1,
    backgroundColor: '#e5ddd1',
    marginVertical: 8,
  },
  iconBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1f5e37',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  label: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '800',
    color: '#55655d',
    textAlign: 'center',
  },
  value: {
    fontSize: 25,
    lineHeight: 28,
    fontWeight: '800',
    color: '#18341d',
    textAlign: 'center',
  },
  helper: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '600',
    color: '#6b766e',
    textAlign: 'center',
  },
});
