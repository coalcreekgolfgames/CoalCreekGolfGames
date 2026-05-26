import React from 'react';
import {
  Image,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

const DEBUG_BRANDING = false;

type BrandWatermarkBackgroundProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  opacity?: number;
  screenName?: string;
};

export function BrandWatermarkBackground({
  children,
  style,
  opacity = 0.3,
  screenName,
}: BrandWatermarkBackgroundProps) {
  const { width, height } = useWindowDimensions();
  const watermarkSize = Math.max(Math.min(width * 0.84, height * 0.52), 260);
  const effectiveOpacity = Math.max(Math.min(opacity, 0.3), 0.22);
  const watermarkAsset = 'assets/images/coal-creek-logo-watermark.png';

  if (__DEV__ && DEBUG_BRANDING && screenName) {
    console.log('[branding] watermark runtime source', {
      screenName,
      asset: watermarkAsset,
      receivedOpacity: opacity,
      effectiveOpacity,
      centered: true,
      componentFile: 'components/BrandWatermarkBackground.tsx',
    });
    if (screenName === 'HoleEditorScreen') {
      console.log('[branding] live round watermark wrapper active');
    }
  }

  return (
    <View style={[styles.screen, style]}>
      <View pointerEvents="none" style={styles.watermarkLayer}>
        <Image
          source={require('@/assets/images/coal-creek-logo-watermark.png')}
          onLayout={(event) => {
            if (!__DEV__ || !DEBUG_BRANDING) return;
            console.log('[branding] watermark image layout', {
              screenName: screenName ?? null,
              width: event.nativeEvent.layout.width,
              height: event.nativeEvent.layout.height,
              x: event.nativeEvent.layout.x,
              y: event.nativeEvent.layout.y,
            });
          }}
          style={[
            styles.watermarkPrimary,
            {
              opacity: effectiveOpacity,
              width: watermarkSize,
              height: watermarkSize,
            },
          ]}
          resizeMode="contain"
        />
      </View>
      <View style={styles.contentLayer}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f4f0e7',
    overflow: 'hidden',
  },
  watermarkLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  watermarkPrimary: {
    tintColor: '#48654f',
  },
  contentLayer: {
    flex: 1,
    zIndex: 1,
  },
});
