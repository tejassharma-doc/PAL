import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { PAL, FONT } from '../theme'

import AskScreen from '../screens/AskScreen'
import RecordsScreen from '../screens/RecordsScreen'
import HistoryScreen from '../screens/HistoryScreen'
import VisitsScreen from '../screens/VisitsScreen'
import SettingsScreen from '../screens/SettingsScreen'

export type RootStackParamList = {
  Main: undefined
  Settings: undefined
}

const Stack = createNativeStackNavigator<RootStackParamList>()
const Tab = createBottomTabNavigator()

interface TabIconProps { icon: string; label: string; focused: boolean }

function TabIcon({ icon, label, focused }: TabIconProps) {
  return (
    <View style={tabS.item}>
      <Text style={[tabS.icon, { color: focused ? PAL.jade : PAL.textDark, opacity: focused ? 1 : 0.4 }]}>
        {icon}
      </Text>
      <Text style={[tabS.label, { color: focused ? PAL.jade : PAL.textMuted }]}>
        {label}
      </Text>
    </View>
  )
}

function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: tabS.bar,
        tabBarShowLabel: false,
      }}
    >
      <Tab.Screen
        name="Ask"
        component={AskScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon icon="◎" label="ASK" focused={focused} /> }}
      />
      <Tab.Screen
        name="Record"
        component={RecordsScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon icon="⛁" label="RECORD" focused={focused} /> }}
      />
      <Tab.Screen
        name="History"
        component={HistoryScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon icon="◷" label="HISTORY" focused={focused} /> }}
      />
      <Tab.Screen
        name="Visits"
        component={VisitsScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon icon="✦" label="VISITS" focused={focused} /> }}
      />
    </Tab.Navigator>
  )
}

export default function AppNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Main" component={TabNavigator} />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          headerShown: true,
          title: 'Settings',
          headerBackTitle: 'Back',
          headerStyle: { backgroundColor: PAL.bg } as any,
          headerTintColor: PAL.textDark,
          headerTitleStyle: { fontFamily: FONT.serif, fontWeight: '300' },
        }}
      />
    </Stack.Navigator>
  )
}

const tabS = StyleSheet.create({
  bar: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: PAL.surfaceBorder,
    height: 64,
    paddingTop: 4,
    paddingBottom: 8,
    elevation: 0,
    shadowOpacity: 0,
  },
  item: { alignItems: 'center', justifyContent: 'center', gap: 2 },
  icon: { fontSize: 17 },
  label: {
    fontFamily: FONT.mono, fontSize: 8, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
})
