import React from 'react'
import {Text, View, StyleSheet} from 'react-native'
import {createNativeStackNavigator} from '@react-navigation/native-stack'
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs'
import {PAL, FONT} from '../theme'

import AskScreen from '../screens/AskScreen'
import RecordsScreen from '../screens/RecordsScreen'
import HistoryScreen from '../screens/HistoryScreen'
import VisitsScreen from '../screens/VisitsScreen'
import SettingsScreen from '../screens/SettingsScreen'

// ── Route param maps ──────────────────────────────────────────────────────────

export type RootStackParamList = {
  Tabs: undefined
  Settings: undefined
}

export type TabParamList = {
  Ask: undefined
  Record: undefined
  History: undefined
  Visits: undefined
}

const Stack = createNativeStackNavigator<RootStackParamList>()
const Tab   = createBottomTabNavigator<TabParamList>()

// ── Tab bar icon — simple text fallback (no icon fonts required) ──────────────

function TabIcon({label, focused}: {label: string; focused: boolean}) {
  const icons: Record<string, string> = {
    Ask: '💬', Record: '📋', History: '📈', Visits: '🏥',
  }
  return (
    <View style={tabIconStyles.wrap}>
      <Text style={[tabIconStyles.icon, focused && tabIconStyles.iconActive]}>
        {icons[label] ?? '●'}
      </Text>
      <Text style={[tabIconStyles.label, focused && tabIconStyles.labelActive]}>
        {label}
      </Text>
    </View>
  )
}

const tabIconStyles = StyleSheet.create({
  wrap:        {alignItems: 'center', paddingTop: 4},
  icon:        {fontSize: 20, opacity: 0.4},
  iconActive:  {opacity: 1},
  label:       {fontFamily: FONT.mono, fontSize: 9, color: PAL.textFaint, marginTop: 2},
  labelActive: {color: PAL.jade},
})

// ── Bottom tab navigator ──────────────────────────────────────────────────────

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: PAL.surface,
          borderTopColor: PAL.surfaceBorder,
          height: 64,
        },
        tabBarShowLabel: false,
      }}
    >
      <Tab.Screen
        name="Ask"
        component={AskScreen}
        options={{tabBarIcon: ({focused}) => <TabIcon label="Ask" focused={focused} />}}
      />
      <Tab.Screen
        name="Record"
        component={RecordsScreen}
        options={{tabBarIcon: ({focused}) => <TabIcon label="Record" focused={focused} />}}
      />
      <Tab.Screen
        name="History"
        component={HistoryScreen}
        options={{tabBarIcon: ({focused}) => <TabIcon label="History" focused={focused} />}}
      />
      <Tab.Screen
        name="Visits"
        component={VisitsScreen}
        options={{tabBarIcon: ({focused}) => <TabIcon label="Visits" focused={focused} />}}
      />
    </Tab.Navigator>
  )
}

// ── Root stack ────────────────────────────────────────────────────────────────

export default function AppNavigator() {
  return (
    <Stack.Navigator screenOptions={{headerShown: false}}>
      <Stack.Screen name="Tabs" component={Tabs} />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{headerShown: true, title: 'Settings', headerBackTitle: 'Back'}}
      />
    </Stack.Navigator>
  )
}
