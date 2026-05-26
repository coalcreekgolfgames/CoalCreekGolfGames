module.exports = ({ config }) => {
  const { version: appVersion } = require('./package.json');
  const profile = process.env.EAS_BUILD_PROFILE ?? 'development';

  const isDevelopment = profile === 'development';
  const isPreview = profile === 'preview';

  const androidPackage = isDevelopment
    ? 'ca.coalcreek.golf.dev'
    : isPreview
      ? 'ca.coalcreek.golf.preview'
      : 'com.coalcreekyardage.book';

  const iosBundleIdentifier = isDevelopment
    ? 'ca.coalcreek.golf.dev'
    : isPreview
      ? 'ca.coalcreek.golf.preview'
      : 'com.coalcreekyardage.book';

  const appName = isDevelopment
    ? 'Coal Creek Golf Dev'
    : isPreview
      ? 'Coal Creek Golf Preview'
      : 'CoalCreekYardageBookExpo';

  return {
    expo: {
      name: appName,
      slug: 'CoalCreekYardageBookExpo',
      version: appVersion,
      orientation: 'portrait',
      icon: './assets/images/icon.png',
      scheme: 'coalcreekyardagebookexpo',
      userInterfaceStyle: 'automatic',
      ios: {
  	supportsTablet: true,
  	bundleIdentifier: iosBundleIdentifier,
  	infoPlist: {
    	    ITSAppUsesNonExemptEncryption: false,
  	},
      },
      android: {
        package: androidPackage,
        adaptiveIcon: {
          backgroundColor: '#f4f0e7',
          foregroundImage: './assets/images/adaptive-icon.png',
          backgroundImage: './assets/images/adaptive-icon-background.png',
          monochromeImage: './assets/images/adaptive-icon.png',
        },
        predictiveBackGestureEnabled: false,
      },
      web: {
        output: 'static',
        favicon: './assets/images/favicon.png',
      },
      plugins: [
        'expo-router',
        'expo-font',
        'expo-image',
        'expo-web-browser',
        [
          'expo-splash-screen',
          {
            image: './assets/images/splash-icon.png',
            imageWidth: 200,
            resizeMode: 'contain',
            backgroundColor: '#ffffff',
            dark: {
              backgroundColor: '#000000',
            },
          },
        ],
      ],
      experiments: {
        typedRoutes: true,
        reactCompiler: true,
      },
      updates: {
        url: 'https://u.expo.dev/8bec8bf6-985d-40d6-b78d-39428b337232',
      },
      runtimeVersion: {
        policy: 'appVersion',
      },
      extra: {
        easBuildProfile: profile,
        eas: {
          projectId: '8bec8bf6-985d-40d6-b78d-39428b337232',
        },
      },
    },
  };
};
