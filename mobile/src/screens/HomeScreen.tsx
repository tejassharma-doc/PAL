import React from 'react'
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native'
import {useNavigation} from '@react-navigation/native'
import type {NativeStackNavigationProp} from '@react-navigation/native-stack'
import type {RootStackParamList} from '../navigation/AppNavigator'

type HomeNav = NativeStackNavigationProp<RootStackParamList, 'Home'>

export default function HomeScreen(): React.JSX.Element {
  const navigation = useNavigation<HomeNav>()

  return (
    <View style={styles.container}>
      <Text style={styles.title}>PAL</Text>
      <Text style={styles.subtitle}>Personal AI Life</Text>
      <TouchableOpacity
        style={styles.searchButton}
        onPress={() => navigation.navigate('Search')}
        accessibilityRole="button"
        accessibilityLabel="Open health search">
        <Text style={styles.searchButtonText}>Search your health</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    padding: 24,
  },
  title: {
    fontSize: 48,
    fontWeight: '700',
    color: '#1a1a2e',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: '#555',
    marginBottom: 48,
  },
  searchButton: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 40,
  },
  searchButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
})
