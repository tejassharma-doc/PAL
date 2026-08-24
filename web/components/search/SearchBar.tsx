'use client'

import { useState, useRef } from 'react'

interface Props {
  onSearch: (query: string) => void
  loading?: boolean
  placeholder?: string
}

export function SearchBar({ onSearch, loading, placeholder }: Props) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const submit = () => {
    const q = value.trim()
    if (!q || loading) return
    onSearch(q)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="w-full space-y-2">
      <div className="relative w-full bg-ground-light rounded-2xl border border-surface/15 focus-within:border-jade/60 transition-colors">
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? 'Ask a health question…'}
          rows={3}
          className="w-full bg-transparent px-5 pt-4 pb-12 text-surface placeholder-surface/30 resize-none outline-none font-serif text-lg leading-relaxed"
          aria-label="Health question input"
        />
        <div className="absolute bottom-3 right-3 flex items-center gap-2">
          {/* Voice button placeholder */}
          <button
            type="button"
            className="p-2 rounded-lg text-surface/30 hover:text-jade transition-colors"
            aria-label="Tap to speak"
            title="Voice input"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          </button>

          <button
            onClick={submit}
            disabled={!value.trim() || loading}
            className="px-4 py-2 bg-jade text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-jade-dark transition-colors"
            aria-label="Submit question"
          >
            {loading ? '…' : 'Ask'}
          </button>
        </div>
      </div>
      <p className="text-surface/25 text-xs text-center">
        Press Enter to search · Shift+Enter for new line · Your data stays private
      </p>
    </div>
  )
}
