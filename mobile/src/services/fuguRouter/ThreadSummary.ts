/**
 * ThreadSummary — persists rolling conversation summaries across app restarts.
 *
 * The API sends `thread_summary_for_router` in every response (max 500 chars).
 * We store it per conversation_id so the Fugu Router can prepend it to the
 * next query embedding for turn-aware classification.
 *
 * AsyncStorage key format: `fugu_thread_summary_<conversationId>`
 */

import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY_PREFIX = 'fugu_thread_summary_'

function key(conversationId: string): string {
  return `${KEY_PREFIX}${conversationId}`
}

export class ThreadSummary {
  /** In-memory cache so reads are synchronous after first load. */
  private cache = new Map<string, string>()

  /** Get the stored summary for a conversation (empty string if none). */
  get(conversationId: string): string {
    return this.cache.get(conversationId) ?? ''
  }

  /**
   * Update the summary for a conversation and persist to AsyncStorage.
   * Fire-and-forget — does not block the router.
   */
  update(conversationId: string, summary: string): void {
    this.cache.set(conversationId, summary)
    AsyncStorage.setItem(key(conversationId), summary).catch(() => {
      // Persist failure is non-fatal — next turn will re-receive the summary from the API.
    })
  }

  /** Clear an ended conversation from cache and storage. */
  async clear(conversationId: string): Promise<void> {
    this.cache.delete(conversationId)
    try { await AsyncStorage.removeItem(key(conversationId)) } catch { /* non-fatal */ }
  }

  /**
   * Rehydrate cache from AsyncStorage (call once at app launch for any
   * in-flight conversation_ids the caller already knows about).
   */
  async rehydrate(conversationIds: string[]): Promise<void> {
    const pairs = await AsyncStorage.multiGet(conversationIds.map(key))
    for (const [k, v] of pairs) {
      if (v) {
        const convId = k.replace(KEY_PREFIX, '')
        this.cache.set(convId, v)
      }
    }
  }
}

/** Singleton — shared across the app. */
export const threadSummary = new ThreadSummary()
