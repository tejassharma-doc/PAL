import type { CapacitorConfig } from '@capacitor/cli'

const isDev = process.env.NODE_ENV !== 'production'

const config: CapacitorConfig = {
  appId: 'com.pal.health',
  appName: 'PAL',
  // In Capacitor builds we do `next build && next export` → output goes to `out/`.
  // For static export, set output: 'export' in next.config.js before running `npx cap sync`.
  webDir: 'out',
  server: {
    // Dev: point native WebView at the local Next.js dev server (no rebuild needed).
    // Production: remove server block so Capacitor uses the bundled webDir files.
    url: isDev ? 'http://localhost:3003' : undefined,
    cleartext: isDev, // allow http in dev; production uses https
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      backgroundColor: '#37b59b',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
  ios: {
    contentInset: 'always',
    preferredContentMode: 'mobile',
  },
  android: {
    allowMixedContent: isDev,
    captureInput: true,
    webContentsDebuggingEnabled: isDev,
  },
}

export default config
