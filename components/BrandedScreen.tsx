import React from 'react';
import { ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { BrandWatermarkBackground } from '@/components/BrandWatermarkBackground';
import { CoalCreekHeader } from '@/components/CoalCreekHeader';

type BrandedScreenProps = {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  screenName?: string;
  scroll?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  bodyStyle?: StyleProp<ViewStyle>;
  showWatermark?: boolean;
};

export function BrandedScreen({
  children,
  title,
  subtitle,
  screenName,
  scroll = true,
  contentContainerStyle,
  bodyStyle,
  showWatermark = true,
}: BrandedScreenProps) {
  const content = (
    <>
      <CoalCreekHeader />
      {(title || subtitle) ? (
        <View style={styles.titleWrap}>
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
      ) : null}

      {scroll ? (
        <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, contentContainerStyle]}>
          <View style={bodyStyle}>{children}</View>
        </ScrollView>
      ) : (
        <View style={[styles.content, contentContainerStyle, bodyStyle]}>{children}</View>
      )}
    </>
  );

  if (!showWatermark) {
    return <View style={styles.screen}>{content}</View>;
  }

  return (
    <BrandWatermarkBackground screenName={screenName} style={styles.screen}>
      {content}
    </BrandWatermarkBackground>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  titleWrap: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 2,
    gap: 6,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#132117',
    textAlign: 'left',
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#5a6b61',
    textAlign: 'left',
  },
  scroll: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    padding: 16,
    gap: 16,
    paddingBottom: 24,
  },
});
