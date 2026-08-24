import React, {useEffect} from 'react'
import {NavigationContainer} from '@react-navigation/native'
import {SafeAreaProvider} from 'react-native-safe-area-context'
import AppNavigator from './src/navigation/AppNavigator'
import {initFuguRouter} from './src/services/fuguRouter'

export default function App(): React.JSX.Element {
  useEffect(() => {
    // Init FuguRouter at launch. If the ONNX model is bundled it loads fully;
    // otherwise it silently falls back to the pure-JS keyword classifier.
    initFuguRouter().catch(() => {})
  }, [])

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  )
}
