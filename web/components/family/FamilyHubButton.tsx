'use client';

/**
 * Family Hub chat button — AppBar, top right, immediately left of the settings
 * gear, so the row reads:  [ chat ]  [ ⚙ ]  [ 🔔 ]
 *
 * Fully self-contained on purpose. It takes no required props, owns its own
 * unread count, and renders NOTHING when the user has no family plan (or when
 * the family/chat feature is off server-side). That is what makes it safe to
 * drop into three different AppBar implementations without touching their state.
 *
 * Badge behaviour mirrors the bell exactly — same 16px circle, same
 * `--rose` (#c2675e), same mono 0.54rem, same -4/-4 offset — because the user
 * should not have to learn two notification idioms.
 *
 * Unread count sources, cheapest first:
 *   1. GET /api/chat/unread-count on mount
 *   2. live +1 when a `room_message` from someone else arrives on the shared socket
 *   3. refetch when the tab regains focus
 *   4. instant clear when the Care Hub page announces it marked the room read
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { chatUnreadCount, getFamilyPlan } from '@/lib/family-api';
import { CHAT_READ_EVENT } from '@/lib/chatSocket';
import { useChatSocket, type ChatFrame } from '@/lib/useChatSocket';

/** The two-bubble mark from the supplied asset, redrawn as inline SVG.
 *
 * The outer rounded square in the source PNG is the BUTTON chrome, which the
 * AppBar already provides — so only the bubbles are drawn here. The front
 * bubble carries a background-coloured stroke to reproduce the white separation
 * gap where it overlaps the back bubble.
 */
function ChatBubblesIcon({ size = 19, color = '#0d1f24' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      {/* back bubble + tail (bottom-left) */}
      <path
        d="M3.7 2.6h8.3a2.35 2.35 0 0 1 2.35 2.35v4.6A2.35 2.35 0 0 1 12 11.9H7.6l-2.45 2.2a.42.42 0 0 1-.7-.31V11.9H3.7A2.35 2.35 0 0 1 1.35 9.55v-4.6A2.35 2.35 0 0 1 3.7 2.6Z"
        fill={color}
      />
      {/* front bubble + tail (bottom-right), ringed in the button background */}
      <path
        d="M9.9 7.35h6.5a2.3 2.3 0 0 1 2.3 2.3v3.6a2.3 2.3 0 0 1-2.3 2.3h-.35v1.75a.42.42 0 0 1-.7.31l-2.3-2.06H9.9a2.3 2.3 0 0 1-2.3-2.3v-3.6a2.3 2.3 0 0 1 2.3-2.3Z"
        fill={color}
        stroke="#fff"
        strokeWidth="1.5"
      />
      {/* the three dots */}
      <g fill="#fff">
        <circle cx="10.95" cy="11.45" r="0.88" />
        <circle cx="13.15" cy="11.45" r="0.88" />
        <circle cx="15.35" cy="11.45" r="0.88" />
      </g>
    </svg>
  );
}

/**
 * Module-level cache for "does this account have a family plan?".
 *
 * This button lives in the AppBar, which remounts on every route change. Without
 * a cache it would fire GET /api/family/plan on every navigation — a wasted
 * round trip per screen, on a phone. Plan existence changes at most once in a
 * session, so a 5-minute TTL is generous, and the in-flight promise is shared so
 * two AppBars mounting at once make one request.
 */
const PLAN_TTL_MS = 5 * 60 * 1000;
let planCache: { at: number; available: boolean } | null = null;
let planInFlight: Promise<boolean> | null = null;

function checkPlanAvailable(): Promise<boolean> {
  // Signed out? Don't fire a request that is guaranteed to 401 on every page.
  if (typeof window !== 'undefined' && !localStorage.getItem('pal_token')) {
    return Promise.resolve(false);
  }
  if (planCache && Date.now() - planCache.at < PLAN_TTL_MS) {
    return Promise.resolve(planCache.available);
  }
  if (planInFlight) return planInFlight;

  planInFlight = getFamilyPlan()
    .then((plan) => {
      const available = !!plan;
      planCache = { at: Date.now(), available };
      return available;
    })
    .catch(() => {
      // Cache the negative too, briefly, so a 404/disabled feature does not
      // retry on every screen.
      planCache = { at: Date.now(), available: false };
      return false;
    })
    .finally(() => {
      planInFlight = null;
    });

  return planInFlight;
}

/** Call after joining/creating a plan so the button appears without a reload. */
export function invalidateFamilyPlanCache(): void {
  planCache = null;
}

export interface FamilyHubButtonProps {
  /** Button edge length. 34 matches the bell; 32 matches the gear. */
  size?: number;
  /** Override the destination. Defaults to /family/hub. */
  href?: string;
  /** Render even when the account has no family plan (used by the mock/preview). */
  forceVisible?: boolean;
  /** Seed the badge without a network call (used by the mock/preview). */
  initialUnread?: number;
}

export default function FamilyHubButton({
  size = 34,
  href = '/family/hub',
  forceVisible = false,
  initialUnread,
}: FamilyHubButtonProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [available, setAvailable] = useState<boolean>(forceVisible);
  const [unread, setUnread] = useState<number>(initialUnread ?? 0);
  const mounted = useRef(true);

  // The shared singleton socket — this does NOT open a second connection.
  const chat = useChatSocket({ enabled: available && !forceVisible });

  const refresh = useCallback(async () => {
    try {
      const n = await chatUnreadCount();
      if (mounted.current) setUnread(n);
    } catch {
      /* leave the last known count */
    }
  }, []);

  // Is there a family plan at all? Fail closed — no plan, no button.
  useEffect(() => {
    mounted.current = true;
    if (forceVisible) return () => { mounted.current = false; };

    checkPlanAvailable().then((ok) => {
      if (!mounted.current) return;
      setAvailable(ok);
      if (ok) refresh();
    });

    return () => {
      mounted.current = false;
    };
  }, [forceVisible, refresh]);

  // Live increment. Someone else posting to any room the user is in counts.
  useEffect(() => {
    if (!available || forceVisible) return;
    return chat.onMessage((f: ChatFrame) => {
      if (f.type === 'room_message') {
        const me = typeof window === 'undefined' ? null : localStorage.getItem('pal_user_id');
        if (me && f.sender_id === me) return; // our own echo to other devices
        // Sitting in the hub already? That page marks read; don't badge it.
        if (pathname === href) return;
        setUnread((n) => n + 1);
      } else if (f.type === 'notification') {
        refresh();
      }
    });
  }, [available, forceVisible, chat, pathname, href, refresh]);

  // Refetch on focus, and clear the moment the hub says it marked read.
  useEffect(() => {
    if (!available || forceVisible || typeof window === 'undefined') return;

    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const onRead = () => setUnread(0);

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener(CHAT_READ_EVENT, onRead);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener(CHAT_READ_EVENT, onRead);
    };
  }, [available, forceVisible, refresh]);

  if (!available) return null;

  const onHub = pathname === href;
  const label = unread > 0 ? `Family Care Hub, ${unread} unread` : 'Family Care Hub';

  return (
    <button
      onClick={() => {
        setUnread(0);
        router.push(href);
      }}
      aria-label={label}
      title={label}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.32),
        border: onHub ? '1px solid rgba(55,181,155,.55)' : '1px solid rgba(13,31,36,.10)',
        background: '#fff',
        cursor: 'pointer',
        display: 'grid',
        placeItems: 'center',
        position: 'relative',
        flexShrink: 0,
        padding: 0,
      }}
    >
      <ChatBubblesIcon size={Math.round(size * 0.56)} color={onHub ? '#1f7d6b' : '#0d1f24'} />

      {unread > 0 ? (
        <span
          style={{
            position: 'absolute',
            top: -4,
            right: -4,
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            background: '#c2675e',
            color: '#fff',
            fontFamily: "'Space Mono', monospace",
            fontSize: '0.54rem',
            fontWeight: 700,
            display: 'grid',
            placeItems: 'center',
            padding: unread > 9 ? '0 4px' : 0,
            lineHeight: 1,
          }}
        >
          {unread > 9 ? '9+' : unread}
        </span>
      ) : null}
    </button>
  );
}

export { ChatBubblesIcon };
