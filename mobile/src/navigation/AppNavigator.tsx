import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { C, F } from '../theme'
import { useAuth } from '../context/AuthContext'
import { Loading } from '../components/ui'
import { LineIcon } from '../components/icons'

import LoginScreen from '../screens/LoginScreen'
import CreateProfileScreen from '../screens/CreateProfileScreen'
import AskScreen from '../screens/AskScreen'
import HistoryScreen from '../screens/HistoryScreen'
import RecordsScreen from '../screens/RecordsScreen'
import UploadScreen from '../screens/UploadScreen'
import FamilyScreen from '../screens/FamilyScreen'
import VisitsScreen from '../screens/VisitsScreen'
import ProfileScreen from '../screens/ProfileScreen'
import MedicationsScreen from '../screens/MedicationsScreen'
import ConversationScreen from '../screens/ConversationScreen'
import NotificationsScreen from '../screens/NotificationsScreen'
import SettingsScreen from '../screens/SettingsScreen'

export type RootStackParamList = {
  Login: undefined
  CreateProfile: undefined
  Main: { screen?: string; params?: object } | undefined
  Conversation: { id: string; title?: string | null }
  Profile: undefined
  Medicines: undefined
  Notifications: undefined
  Settings: undefined
  Family: undefined
}

const Stack = createNativeStackNavigator<RootStackParamList>()
const Tab = createBottomTabNavigator()

/**
 * Five bottom tabs (the website uses the same five, same icons). Family lives
 * in the top bar (family-chat button), not here.
 */
const TABS: { name: string; label: string; icon: string; component: React.ComponentType<any> }[] = [
  { name: 'Ask', label: 'Ask', icon: 'message-circle', component: AskScreen },
  { name: 'History', label: 'History', icon: 'history', component: HistoryScreen },
  { name: 'Record', label: 'Records', icon: 'file-text', component: RecordsScreen },
  { name: 'Upload', label: 'Upload', icon: 'upload', component: UploadScreen },
  { name: 'Visits', label: 'Visits', icon: 'calendar-days', component: VisitsScreen },
]

function TabIcon({ icon, label, focused }: { icon: string; label: string; focused: boolean }) {
  const color = focused ? C.jadeD : C.icon
  return (
    <View style={tabS.item}>
      <View style={[tabS.pill, focused && { backgroundColor: C.activeTint }]}>
        <LineIcon name={icon} size={24} color={color} strokeWidth={focused ? 2.3 : 2} />
      </View>
      <Text style={[tabS.label, { color, fontFamily: focused ? F.sansBold : F.sansSemi }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  )
}

function TabNavigator() {
  const insets = useSafeAreaInsets()
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarHideOnKeyboard: true,
        tabBarStyle: [tabS.bar, { height: 78 + insets.bottom, paddingBottom: 8 + insets.bottom }],
      }}
    >
      {TABS.map(t => (
        <Tab.Screen
          key={t.name}
          name={t.name}
          component={t.component}
          options={{
            tabBarIcon: ({ focused }) => <TabIcon icon={t.icon} label={t.label} focused={focused} />,
            tabBarAccessibilityLabel: t.label,
          }}
        />
      ))}
    </Tab.Navigator>
  )
}

export default function AppNavigator() {
  const { ready, session } = useAuth()
  if (!ready) return <Loading label="starting PAL…" />

  return (
    <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.soft } }}>
      {!session ? (
        <Stack.Screen name="Login" component={LoginScreen} />
      ) : !session.patientId ? (
        <Stack.Screen name="CreateProfile" component={CreateProfileScreen} />
      ) : (
        <>
          <Stack.Screen name="Main" component={TabNavigator} />
          <Stack.Screen name="Conversation" component={ConversationScreen} />
          <Stack.Screen name="Profile" component={ProfileScreen} />
          <Stack.Screen name="Medicines" component={MedicationsScreen} />
          <Stack.Screen name="Notifications" component={NotificationsScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
          <Stack.Screen name="Family" component={FamilyScreen} />
        </>
      )}
    </Stack.Navigator>
  )
}

const tabS = StyleSheet.create({
  bar: {
    backgroundColor: C.soft,
    borderTopWidth: 1,
    borderTopColor: C.line,
    paddingTop: 8,
    elevation: 0,
    shadowOpacity: 0,
  },
  item: { alignItems: 'center', justifyContent: 'center', gap: 3, minWidth: 64, minHeight: 52 },
  pill: { paddingHorizontal: 14, paddingVertical: 4, borderRadius: 14 },
  label: { fontSize: 12.5, lineHeight: 16 },
})
