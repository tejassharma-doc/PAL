'use client';

/**
 * The real unread-notification count for the AppBar bell.
 *
 * WHAT THIS REPLACES
 * ------------------
 * Every page passed `badgeCount={3}`. The bell was a mock: a hard-coded 3 that
 * never moved, on `/history`, `/history/[id]`, `/notifications`, `/visits` and
 * the visits variants. `notificationUnreadCount()` existed in lib/family-api.ts
 * and was never called from anywhere, and `/notifications/page.tsx` renders
 * static sample content rather than the backend's notifications.
 *
 * So "the notification is delayed" was, for the bell, not a delay at all — the
 * number was a constant. What *did* move was the chat icon's badge next to it.
 *
 * HOW IT STAYS CURRENT
 * --------------------
 * Four sources, the same set the chat badge uses:
 *   1. one fetch when it mounts
 *   2. live `notification` frames on the shared transport — no polling
 *   3. a refetch when the tab regains focus, for anything missed while hidden
 *   4. a recount after the bell is opened, so reading them clears it
 *
 * There is deliberately no `setInterval`. A timer would be a second, slower
 * source of truth competing with the stream, and the reason the stream exists
 * is that periodic refreshes are what the user experienced as "delayed".
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { notificationUnreadCount } from './family-api';
import { useChatSocket, type ChatFrame } from './useChatSocket';

export function useNotificationBadge(): number {
  const [count, setCount] = useState(0);
  const [signedIn, setSignedIn] = useState(false);
  const pathname = usePathname();
  const mounted = useRef(true);

  const chat = useChatSocket({ enabled: signedIn });

  const refresh = useCallback(async () => {
    try {
      const n = await notificationUnreadCount();
      if (mounted.current) setCount(n);
    } catch {
      /* keep the last known value rather than flashing zero */
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const token = typeof window === 'undefined' ? null : localStorage.getItem('pal_token');
    if (!token) return () => { mounted.current = false; };
    setSignedIn(true);
    void refresh();
    return () => { mounted.current = false; };
  }, [refresh]);

  // Live. This is what makes the bell keep up with the conversation instead of
  // waiting for the next page load.
  useEffect(() => {
    if (!signedIn) return;
    return chat.onMessage((f: ChatFrame) => {
      if (f.type === 'notification') setCount((n) => n + 1);
    });
  }, [signedIn, chat]);

  // Anything that happened while the tab was in the background.
  useEffect(() => {
    if (!signedIn || typeof window === 'undefined') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [signedIn, refresh]);

  // Opening the bell is what clears it.
  useEffect(() => {
    if (signedIn && pathname === '/notifications') void refresh();
  }, [pathname, signedIn, refresh]);

  return count;
}
