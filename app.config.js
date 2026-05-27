module.exports = ({ config }) => {
  const { version: appVersion } = require('./package.json');
  const variant = process.env.APP_VARIANT ?? process.env.EAS_BUILD_PROFILE ?? 'development';

  const variantConfig = {
    development: {
      name: 'Coal Creek Golf Dev',
      iosBundleIdentifier: 'ca.coalcreek.golf.dev',
      androidPackage: 'ca.coalcreek.golf.dev',
    },
    preview: {
      name: 'Coal Creek Golf Preview',
      iosBundleIdentifier: 'ca.coalcreek.golf.preview',
      androidPackage: 'ca.coalcreek.golf.preview',
    },
    production: {
      name: 'Coal Creek Golf',
      iosBundleIdentifier: 'com.coalcreekyardage.book',
      androidPackage: 'com.coalcreekyardage.book',
    },
  };

  const { name: appName, iosBundleIdentifier, androidPackage } =
    variantConfig[variant] ?? variantConfig.development;

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
        easBuildProfile: variant,
        eas: {
          projectId: '8bec8bf6-985d-40d6-b78d-39428b337232',
        },
      },
    },
  };
};
