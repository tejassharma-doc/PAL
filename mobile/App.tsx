import React, { useEffect } from 'react'
import { StatusBar } from 'react-native'
import { NavigationContainer, DefaultTheme } from '@react-navigation/native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import AppNavigator from './src/navigation/AppNavigator'
import { AuthProvider } from './src/context/AuthContext'
import { initFuguRouter } from './src/services/fuguRouter'
import { PAL } from './src/theme'

const theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, primary: PAL.jade, background: PAL.bg, card: '#fff', text: PAL.textDark },
}

export default function App(): React.JSX.Element {
  useEffect(() => {
    // On-device safety router. Loads the ONNX model if bundled; otherwise falls
    // back silently to the pure-JS keyword classifier.
    initFuguRouter().catch(() => {})
  }, [])

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <AuthProvider>
        <NavigationContainer theme={theme}>
          <AppNavigator />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  )
}
