import React, {useRef, useState} from 'react'
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  Keyboard,
} from 'react-native'
import {PAL, RADIUS, SPACE} from '../theme'

interface Props {
  onSubmit: (query: string) => void
  onAttach?: () => void
  isLoading: boolean
  placeholder?: string
}

export function SearchBar({onSubmit, onAttach, isLoading, placeholder}: Props): React.JSX.Element {
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
      {/* Paperclip / attach button — MDT document upload */}
      {onAttach && (
        <TouchableOpacity
          style={styles.attachBtn}
          onPress={onAttach}
          accessibilityLabel="Attach medical document"
          accessibilityHint="Upload a lab report PDF or image for extraction"
        >
          <Text style={styles.attachIcon}>📎</Text>
        </TouchableOpacity>
      )}

      <TextInput
        ref={inputRef}
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        placeholder={placeholder ?? 'Ask about your health…'}
        placeholderTextColor={PAL.textFaint}
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
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACE.md,
    paddingVertical: 4,
    marginHorizontal: SPACE.lg,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: PAL.surfaceBorder,
  },
  attachBtn: {
    paddingRight: SPACE.sm,
    paddingVertical: SPACE.sm,
  },
  attachIcon: {fontSize: 18},
  input: {
    flex: 1,
    fontSize: 16,
    color: PAL.textDark,
    paddingVertical: 10,
    paddingRight: SPACE.sm,
  },
  button: {
    backgroundColor: PAL.jade,
    borderRadius: 10,
    width: 38,
    height: 38,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDisabled: {backgroundColor: PAL.jadeFaint},
  buttonLabel: {color: PAL.navyDeep, fontSize: 20, fontWeight: '700'},
})
