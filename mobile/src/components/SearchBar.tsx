/**
 * SearchBar — text input + submit button.
 *
 * Fires onSubmit(query) when the user presses Return or the search button.
 * Disabled while a search is in flight (isLoading=true).
 * Placeholder text rotates through multilingual samples.
 */

import React, {useRef, useState} from 'react'
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  Keyboard,
} from 'react-native'

interface Props {
  onSubmit: (query: string) => void
  isLoading: boolean
  placeholder?: string
}

export function SearchBar({onSubmit, isLoading, placeholder}: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const inputRef = useRef<TextInput>(null)

  function handleSubmit(): void {
    const trimmed = query.trim()
    if (!trimmed || isLoading) return
    Keyboard.dismiss()
    onSubmit(trimmed)
    setQuery('')
  }

  return (
    <View style={styles.row}>
      <TextInput
        ref={inputRef}
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        placeholder={placeholder ?? 'Ask about your health…'}
        placeholderTextColor="#aaa"
        returnKeyType="search"
        onSubmitEditing={handleSubmit}
        editable={!isLoading}
        multiline={false}
        autoCorrect={false}
        autoCapitalize="none"
        accessibilityLabel="Health search input"
      />
      <TouchableOpacity
        style={[styles.button, (isLoading || !query.trim()) && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={isLoading || !query.trim()}
        accessibilityLabel="Submit search"
      >
        <Text style={styles.buttonLabel}>{isLoading ? '…' : '→'}</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 4,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#1a1a1a',
    paddingVertical: 10,
    paddingRight: 8,
  },
  button: {
    backgroundColor: '#1677ff',
    borderRadius: 10,
    width: 38,
    height: 38,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDisabled: {backgroundColor: '#c0d6f7'},
  buttonLabel: {color: '#fff', fontSize: 20, fontWeight: '700'},
})
