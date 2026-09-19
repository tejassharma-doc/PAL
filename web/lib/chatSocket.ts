/**
 * Module-level singleton chat socket, with refcounting.
 *
 * WHY A SINGLETON
 * ---------------
 * The Family Hub button now lives in the AppBar, which renders on essentially
 * every screen. The Care Hub page also needs the socket. If each `useChatSocket()`
 * call opened its own WebSocket, a user sitting on /family/hub would hold two
 * connections, receive every message twice, and double PAL's socket count per
 * user for nothing.
 *
 * So there is exactly ONE connection per browser tab. Hooks acquire and release
 * it; when the last consumer unmounts, a short grace period runs before the
 * socket actually closes (so navigating between screens does not thrash the
 * connection).
 *
 * `useChatSocket()` keeps the same public API it had before this refactor, so
 * app/family/hub/page.tsx needs no changes.
 */

export type ChatFrame = {
  type: string;
  [key: string]: unknown;
};

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed';

const HEARTBEAT_MS = 25_000;
const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
/** Keep the socket alive briefly across route changes. */
const RELEASE_GRACE_MS = 5_000;

/** ws(s):// URL for the PAL chat socket.
 *
 * NOTE: this deliberately does NOT go through the Next `/api/...` proxy —
 * a Next Route Handler cannot proxy a WebSocket upgrade. See APPLY.md §4.
 */
export function chatSocketUrl(token: string): string {
  const explicit = process.env.NEXT_PUBLIC_WS_URL;
  let base: string;

  if (explicit) {
    base = explicit;
  } else if (process.env.NEXT_PUBLIC_API_URL) {
    base = process.env.NEXT_PUBLIC_API_URL;
  } else if (typeof window !== 'undefined') {
    base = window.location.origin;
  } else {
    base = 'http://localhost:8000';
  }

  const wsBase = base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:').replace(/\/$/, '');
  return `${wsBase}/ws/chat?token=${encodeURIComponent(token)}`;
}

type StateListener = (s: ConnectionState, err: string | null) => void;

let ws: WebSocket | null = null;
let state: ConnectionState = 'idle';
let lastError: string | null = null;

let refs = 0;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let backoff = BACKOFF_START_MS;
let intentionalClose = false;

const frameListeners = new Set<(f: ChatFrame) => void>();
const stateListeners = new Set<StateListener>();
/** Rooms we want to be joined to; re-sent after every reconnect. */
const desiredRooms = new Set<string>();

function setState(next: ConnectionState, err: string | null = lastError): void {
  state = next;
  lastError = err;
  stateListeners.forEach((fn) => {
    try {
      fn(state, lastError);
    } catch {
      /* a listener must never break the socket */
    }
  });
}

function clearTimers(): void {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  if (retry) {
    clearTimeout(retry);
    retry = null;
  }
}

function openSocket(): void {
  if (typeof window === 'undefined') return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  const token = localStorage.getItem('pal_token');
  if (!token) {
    setState('closed', 'Not signed in');
    return;
  }

  intentionalClose = false;
  setState('connecting', null);

  let sock: WebSocket;
  try {
    sock = new WebSocket(chatSocketUrl(token));
  } catch (err) {
    setState('closed', String(err));
    return;
  }
  ws = sock;

  sock.onopen = () => {
    if (ws !== sock) {
      sock.close();
      return;
    }
    backoff = BACKOFF_START_MS;
    setState('open', null);
    heartbeat = setInterval(() => {
      if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ action: 'ping' }));
    }, HEARTBEAT_MS);
    // Re-join every room a consumer asked for before the drop.
    desiredRooms.forEach((roomId) => {
      sock.send(JSON.stringify({ action: 'join_room', room_id: roomId }));
    });
  };

  sock.onmessage = (evt) => {
    let frame: ChatFrame;
    try {
      frame = JSON.parse(evt.data as string) as ChatFrame;
    } catch {
      return;
    }
    if (frame.type === 'pong') return;
    frameListeners.forEach((fn) => {
      try {
        fn(frame);
      } catch (err) {
        console.error('[chat] frame handler threw', err);
      }
    });
  };

  sock.onerror = () => {
    setState(state, 'Connection error');
  };

  sock.onclose = (evt) => {
    if (ws !== sock) return;
    clearTimers();
    ws = null;

    if (intentionalClose) {
      setState('closed', null);
      return;
    }

    // 4001 = invalid/expired token. Retrying cannot help until the user signs
    // in again, so stop rather than hammering the API.
    if (evt.code === 4001) {
      setState('closed', 'Session expired — please sign in again');
      return;
    }

    setState('closed', lastError);
    if (refs > 0) {
      const wait = backoff;
      backoff = Math.min(wait * 2, BACKOFF_MAX_MS);
      retry = setTimeout(openSocket, wait);
    }
  };
}

function closeSocket(): void {
  intentionalClose = true;
  clearTimers();
  const sock = ws;
  ws = null;
  desiredRooms.clear();
  if (sock && (sock.readyState === WebSocket.OPEN || sock.readyState === WebSocket.CONNECTING)) {
    sock.close(1000, 'released');
  }
  setState('idle', null);
}

/** Acquire the shared socket. Returns a release function. */
export function acquireChatSocket(): () => void {
  refs += 1;
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  if (!ws) openSocket();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    refs = Math.max(0, refs - 1);
    if (refs === 0) {
      releaseTimer = setTimeout(() => {
        releaseTimer = null;
        if (refs === 0) closeSocket();
      }, RELEASE_GRACE_MS);
    }
  };
}

export function onChatFrame(fn: (f: ChatFrame) => void): () => void {
  frameListeners.add(fn);
  return () => {
    frameListeners.delete(fn);
  };
}

export function onChatState(fn: StateListener): () => void {
  stateListeners.add(fn);
  fn(state, lastError);
  return () => {
    stateListeners.delete(fn);
  };
}

export function getChatState(): { state: ConnectionState; lastError: string | null } {
  return { state, lastError };
}

export function sendChatFrame(frame: Record<string, unknown>): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(frame));
  return true;
}

export function joinChatRoom(roomId: string): boolean {
  desiredRooms.add(roomId);
  return sendChatFrame({ action: 'join_room', room_id: roomId });
}

export function leaveChatRoom(roomId: string): boolean {
  desiredRooms.delete(roomId);
  return sendChatFrame({ action: 'leave_room', room_id: roomId });
}

/** Force a reconnect — call after sign-in so the new token is picked up. */
export function reconnectChatSocket(): void {
  clearTimers();
  const sock = ws;
  ws = null;
  intentionalClose = true;
  if (sock) sock.close(1000, 'reconnect');
  intentionalClose = false;
  backoff = BACKOFF_START_MS;
  if (refs > 0) openSocket();
}

// ── cross-component badge events ─────────────────────────────────────────────
// The Care Hub page dispatches this after it marks a room read, so the AppBar
// badge clears immediately instead of waiting for the next poll.
export const CHAT_READ_EVENT = 'pal:chat-read';

export function announceChatRead(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CHAT_READ_EVENT));
  }
}
