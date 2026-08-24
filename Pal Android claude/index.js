/**
 * PAL Health Android — app entry point.
 * This file is the first JS file loaded by React Native.
 * It registers the root component with the AppRegistry under the name
 * that MainActivity.kt passes to getMainComponentName().
 */
import {AppRegistry} from 'react-native'
import App from './App'
import {name as appName} from './app.json'

AppRegistry.registerComponent(appName, () => App)
