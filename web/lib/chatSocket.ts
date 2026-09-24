/**
 * Singleton realtime transport for PAL chat — Centrifugo, with the native
 * WebSocket kept as a rollback path.
 *
 * THE PUBLIC API OF THIS MODULE IS UNCHANGED. `useChatSocket()`, the Care Hub
 * page and the AppBar button import exactly what they imported before, so the
 * chat UI is untouched by the migration — only the wire underneath moved.
 *
 * WHY A SINGLETON
 * ---------------
 * The Family Hub button renders in the AppBar on nearly every screen, and the
 * Care Hub page needs the same connection. One socket per tab, refcounted, with
 * a short grace period so route changes don't thrash it.
 *
 * WHY CENTRIFUGO
 * --------------
 * Sockets move off the API process onto a dedicated Go server built for
 * 1M+ concurrent connections. PAL's FastAPI pods go back to being stateless.
 *
 * HOW AUTH WORKS (and why the client cannot cheat)
 * ------------------------------------------------
 *  - connection token: POST /api/chat/realtime/connect-token
 *  - per-channel subscription token: POST /api/chat/realtime/subscribe-token
 *    The server re-checks room membership before minting one. Centrifugo
 *    refuses an untokened subscribe outright (error 103), so this endpoint is
 *    the only way in.
 *  - clients CANNOT publish (namespace `publish: false`). `sendChatFrame`
 *    therefore returns false under Centrifugo and callers fall back to
 *    POST /chat/send, which persists, authorises and PHI-redacts before the
 *    server publishes. That fallback already existed for flaky sockets.
 *
 * centrifuge-js refreshes both token kinds on expiry by calling `getToken`
 * again, so a long-lived tab keeps working without a reload.
 */

import { Centrifuge, State, type Subscription } from 'centrifuge';

export type ChatFrame = {
  type: string;
  [key: string]: unknown;
};

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed';
export type Transport = 'centrifugo' | 'sse' | 'native' | 'poll' | 'unknown';

const HEARTBEAT_MS = 25_000;          // native path only
const BACKOFF_START_MS = 1_000;       // native path only
const BACKOFF_MAX_MS = 30_000;
const RELEASE_GRACE_MS = 5_000;

/** How long a transport gets to reach 'open' before we fall back to the next.
 *  Short on purpose: the failures this guards against (a WS upgrade that a
 *  proxy will never carry) do not resolve with patience. */
const TRANSPORT_PROBE_MS = 6_000;
/** Delta-poll cadence, last resort only. Paused while the tab is hidden. */
const POLL_ACTIVE_MS = 2_000;
const POLL_IDLE_MS = 10_000;

// ── shared state ─────────────────────────────────────────────────────────────
let transport: Transport = 'unknown';
let state: ConnectionState = 'idle';
let lastError: string | null = null;

let refs = 0;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
let bootPromise: Promise<void> | null = null;
let centProbe: ReturnType<typeof setTimeout> | null = null;

const frameListeners = new Set<(f: ChatFrame) => void>();
const stateListeners = new Set<(s: ConnectionState, err: string | null) => void>();
/** Rooms consumers want; re-applied after reconnects and transport swaps. */
const desiredRooms = new Set<string>();

// Centrifugo
let centrifuge: Centrifuge | null = null;
let personalSub: Subscription | null = null;
const roomSubs = new Map<string, Subscription>();

// SSE (default transport)
let es: EventSource | null = null;
let sseReady = false;
let sseFailures = 0;

// delta poll (last resort)
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollCursor: Record<string, string> = {};   // roomId -> last created_at seen
let polling = false;

// native fallback
let ws: WebSocket | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let backoff = BACKOFF_START_MS;
let intentionalClose = false;

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('pal_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function setState(next: ConnectionState, err: string | null = lastError): void {
  state = next;
  lastError = err;
  stateListeners.forEach((fn) => {
    try {
      fn(state, lastError);
    } catch {
      /* a listener must never break the transport */
    }
  });
}

function emit(frame: ChatFrame): void {
  frameListeners.forEach((fn) => {
    try {
      fn(frame);
    } catch (err) {
      console.error('[chat] frame handler threw', err);
    }
  });
}

/** ws(s):// origin for the NATIVE socket (rollback path only).
 *
 * Not routed through the Next `/api` proxy: a Route Handler cannot proxy a
 * WebSocket upgrade. See APPLY.md.
 */
export function chatSocketUrl(token: string): string {
  const base =
    process.env.NEXT_PUBLIC_WS_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8000');
  const wsBase = base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:').replace(/\/$/, '');
  return `${wsBase}/ws/chat?token=${encodeURIComponent(token)}`;
}

// ── Centrifugo ───────────────────────────────────────────────────────────────
async function fetchRealtimeConfig(): Promise<{
  transport: Transport;
  url: string | null;
  user_channel: string;
} | null> {
  try {
    const res = await fetch('/api/chat/realtime/config', { headers: authHeaders() });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function getConnectionToken(): Promise<string> {
  const res = await fetch('/api/chat/realtime/connect-token', {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`connect-token ${res.status}`);
  return (await res.json()).token as string;
}

async function getSubscriptionToken(channel: string): Promise<string> {
  const res = await fetch('/api/chat/realtime/subscribe-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ channel }),
  });
  if (!res.ok) {
    // 403 => not a member. Throwing stops centrifuge-js retrying forever.
    throw new Error(`subscribe-token ${res.status} for ${channel}`);
  }
  return (await res.json()).token as string;
}

function subscribeRoomChannel(channel: string): Subscription | null {
  if (!centrifuge) return null;
  const existing = roomSubs.get(channel);
  if (existing) return existing;

  const sub = centrifuge.newSubscription(channel, {
    getToken: () => getSubscriptionToken(channel),
  });
  sub.on('publication', (ctx) => emit(ctx.data as ChatFrame));
  sub.on('subscribed', () => emit({ type: 'joined_room', room_id: channel.split(':')[1] }));
  sub.on('unsubscribed', () => emit({ type: 'left_room', room_id: channel.split(':')[1] }));
  sub.on('error', (ctx) => {
    // Surfaced, not thrown: losing one room must not kill the connection.
    console.warn('[chat] subscription error', channel, ctx.error?.message);
  });
  sub.subscribe();
  roomSubs.set(channel, sub);
  return sub;
}

async function startCentrifugo(url: string, userChannel: string): Promise<void> {
  const client = new Centrifuge(url, {
    getToken: getConnectionToken,
    // Matches the native path's behaviour so reconnect feels identical.
    minReconnectDelay: BACKOFF_START_MS,
    maxReconnectDelay: BACKOFF_MAX_MS,
  });

  client.on('connecting', () => setState('connecting', null));
  client.on('connected', () => setState('open', null));
  client.on('disconnected', (ctx) => setState('closed', ctx.reason || null));
  client.on('error', (ctx) => setState(state, ctx.error?.message ?? 'Connection error'));

  centrifuge = client;

  // Personal channel: DMs + in-app notifications.
  if (userChannel) {
    personalSub = client.newSubscription(userChannel, {
      getToken: () => getSubscriptionToken(userChannel),
    });
    personalSub.on('publication', (ctx) => emit(ctx.data as ChatFrame));
    personalSub.subscribe();
  }

  client.connect();
  desiredRooms.forEach((roomId) => subscribeRoomChannel(`room:${roomId}`));
}

function stopCentrifugo(): void {
  roomSubs.forEach((sub) => {
    try {
      sub.unsubscribe();
      centrifuge?.removeSubscription(sub);
    } catch {
      /* ignore */
    }
  });
  roomSubs.clear();
  if (personalSub) {
    try {
      personalSub.unsubscribe();
      centrifuge?.removeSubscription(personalSub);
    } catch {
      /* ignore */
    }
    personalSub = null;
  }
  if (centrifuge) {
    try {
      centrifuge.disconnect();
    } catch {
      /* ignore */
    }
    centrifuge = null;
  }
}

// ── SSE: the default transport ───────────────────────────────────────────────
/**
 * Why this is the default and the WebSocket is not.
 *
 * A WebSocket needs an HTTP *upgrade*, and the upgrade is the fragile part.
 * It cannot pass through the Next.js `/api` route handler that serves every
 * other call in this app; it needs a reverse proxy configured to forward
 * `Upgrade`/`Connection`; and it answers with a plain 404 if the backend's
 * uvicorn was installed without the `[standard]` extra. All three failures are
 * invisible in the browser — the UI looks fine and new messages simply never
 * arrive until the user reloads, which refetches history over REST.
 *
 * That is the "I have to refresh to see the conversation" bug.
 *
 * SSE is an ordinary GET that never finishes. It rides the proxy that already
 * works, needs no new port and no infrastructure. One connection per tab.
 */
function clearSseWatchdogs(): void {
  if (sseReadyTimer) {
    clearTimeout(sseReadyTimer);
    sseReadyTimer = null;
  }
  if (sseAliveTimer) {
    clearTimeout(sseAliveTimer);
    sseAliveTimer = null;
  }
}

/** Restart the silence timer. Called on EVERY inbound event, including the
 *  server's heartbeat, so an idle-but-healthy stream is never mistaken for a
 *  dead one. */
function noteSseActivity(): void {
  if (sseAliveTimer) clearTimeout(sseAliveTimer);
  sseAliveTimer = setTimeout(() => {
    sseAliveTimer = null;
    if (!sseReady) return;
    sseSilences += 1;
    stopSse();
    startPolling();
    if (sseSilences >= 2) {
      console.warn('[chat] stream went silent twice — staying on periodic refresh');
      transport = 'poll';
      setState('closed', 'Live stream keeps dropping — using periodic refresh');
      return;                       // maybeRecoverStream still retries every 30s
    }
    console.warn('[chat] stream went silent — reconnecting and polling meanwhile');
    setState('connecting', 'Live stream went quiet — reconnecting');
    scheduleSseRestart(500);
  }, sseSilenceLimit());
}

function stopSse(): void {
  clearSseWatchdogs();
  if (sseRetry) {
    clearTimeout(sseRetry);
    sseRetry = null;
  }
  if (es) {
    try {
      es.close();
    } catch {
      /* ignore */
    }
    es = null;
  }
  sseReady = false;
}

let sseRetry: ReturnType<typeof setTimeout> | null = null;
/** startSse awaits a ticket mint, so two callers can be inside it at once —
 *  a retry timer and a visibilitychange, for instance. Without this guard the
 *  loser's EventSource is orphaned: never closed, so the browser holds the
 *  connection and the server holds a queue, a room-set entry and a generator
 *  for the life of the tab. */
let sseStarting = false;
/** Set when a restart is requested while one is already in flight. Dropping
 *  those requests turned the orphan leak into a wedge: a hung ticket fetch held
 *  `sseStarting` true, every restart path returned immediately without
 *  re-arming, and the tab sat on "connecting…" with no transport and no poll
 *  until the user reloaded. */
let sseRestartPending = false;
/** Watchdogs.
 *
 *  `EventSource` reports a connection it cannot open, and a connection that is
 *  closed. It does NOT report a connection that opens and then delivers
 *  nothing — which is what a buffering proxy, a TLS-inspecting antivirus, or a
 *  request queued behind the browser's six-per-origin HTTP/1.1 limit all look
 *  like. No error, no data, forever.
 *
 *  That is device-specific by nature: the same build, same account, works on a
 *  phone and hangs on a laptop behind a corporate network. Without these two
 *  timers the app waits indefinitely and the user learns to press refresh. */
let sseReadyTimer: ReturnType<typeof setTimeout> | null = null;
let sseAliveTimer: ReturnType<typeof setTimeout> | null = null;
let sseHeartbeatMs = 15_000;
/** How many times in a row a stream has connected and then gone silent.
 *
 *  Reconnecting after a silence is right the first time — streams drop. But a
 *  network path that kills every stream a few seconds after it opens (a
 *  buffering proxy, an inspecting firewall) would otherwise put us in a loop:
 *  connect, say "ready", switch polling OFF, go silent, reconnect. The user
 *  gets messages only in the brief windows. After the second silence we stop
 *  believing this path can carry a stream and stay on the poll, still
 *  retrying quietly in the background. */
let sseSilences = 0;
/** No `ready` within this long and the stream is not coming. */
const SSE_READY_DEADLINE_MS = 4_000;
/** Silence longer than this on a stream that DID open means it has died. */
const sseSilenceLimit = () => sseHeartbeatMs * 2 + 5_000;

/** A short-lived ticket for the stream URL, so the account's real access token
 *  never lands in a proxy access log, browser history or Referer. Falls back to
 *  the token if the endpoint is not deployed yet, which keeps this drop
 *  compatible with an older API. */
async function getStreamTicket(): Promise<string | null | undefined> {
  try {
    const res = await fetch('/api/chat/stream-ticket', {
      method: 'POST',
      headers: authHeaders(),
      // Without a deadline a half-open socket (laptop resume, captive portal)
      // can hang this fetch for minutes while the whole transport waits on it.
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 401) return null;        // signed out — do not retry
    // ONLY a 404 means "this API predates stream tickets", and only then is it
    // right to fall back to putting the account's real access token in the URL.
    // Treating every 5xx or network blip as "endpoint missing" would write a
    // long-lived bearer credential into proxy logs and browser history the
    // first time the backend hiccuped — the precise thing the ticket exists to
    // prevent.
    if (res.status === 404) return '';
    if (!res.ok) return undefined;               // transient — retry, do not downgrade
    return ((await res.json()) as { ticket?: string }).ticket ?? '';
  } catch {
    return undefined;                            // network blip — retry
  }
}

async function startSse(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (refs === 0) return;
  if (sseStarting) {
    sseRestartPending = true;      // defer, never drop
    return;
  }
  sseStarting = true;
  try {
    await startSseInner();
  } finally {
    sseStarting = false;
    if (sseRestartPending) {
      sseRestartPending = false;
      scheduleSseRestart(250);
    }
  }
}

async function startSseInner(): Promise<void> {
  const token = localStorage.getItem('pal_token');
  if (!token) {
    setState('closed', 'Not signed in');
    return;
  }

  stopSse();
  setState('connecting', null);

  const ticket = await getStreamTicket();
  if (ticket === null) {
    setState('closed', 'Session expired — please sign in again');
    return;
  }
  if (ticket === undefined) {
    // Could not mint, and it is not a missing endpoint. Retry rather than
    // downgrade the credential — but start the fallback NOW, not after three
    // attempts. Each attempt can take the full 8s fetch deadline, so waiting
    // for the third meant ~30 seconds of a chat that looked simply broken.
    startPolling();
    sseFailures += 1;
    if (sseFailures >= 3) {
      transport = 'poll';
      setState('closed', 'Live stream unavailable — falling back to periodic refresh');
      startPolling();
    } else {
      scheduleSseRestart(1_000 * sseFailures);
    }
    return;
  }
  if (refs === 0) return;                        // released while minting

  const qs = ticket
    ? `ticket=${encodeURIComponent(ticket)}`
    : `token=${encodeURIComponent(token)}`;
  const source = new EventSource(`/api/chat/stream?${qs}`);
  es = source;

  // Poll from the moment we start connecting, not only after a failure.
  // Negotiating the stream takes a ticket round-trip plus two queries, and a
  // message that lands in that window would otherwise wait for the next one.
  // `ready` stops this again immediately.
  startPolling();

  if (sseReadyTimer) clearTimeout(sseReadyTimer);
  sseReadyTimer = setTimeout(() => {
    sseReadyTimer = null;
    if (es !== source || sseReady) return;
    // Opened (or queued) but silent. EventSource will never tell us.
    console.warn('[chat] stream did not deliver within '
      + SSE_READY_DEADLINE_MS + 'ms — falling back');
    stopSse();
    sseFailures += 1;
    startPolling();
    if (sseFailures >= 3) {
      transport = 'poll';
      setState('closed', 'Live stream unavailable — using periodic refresh');
    } else {
      setState('connecting', null);
      scheduleSseRestart(1_000 * sseFailures);
    }
  }, SSE_READY_DEADLINE_MS);

  source.addEventListener('ready', (ev) => {
    if (es !== source) return;
    sseReady = true;
    sseFailures = 0;
    if (sseReadyTimer) {
      clearTimeout(sseReadyTimer);
      sseReadyTimer = null;
    }
    setState('open', null);
    noteSseActivity();
    // Fetch anything written between the last poll and this stream opening —
    // ticket mint plus two queries is tens to hundreds of milliseconds, and a
    // message landing in that window belongs to neither transport. Catch up
    // FIRST, then stop polling.
    void pollOnce().finally(() => {
      // Only switch the backstop off for a path that has never betrayed us.
      if (es === source && sseReady && sseSilences === 0) stopPolling();
    });
    try {
      const info = JSON.parse((ev as MessageEvent).data) as { rooms?: string[]; heartbeat?: number };
      // The server joins every room the user is a member of. If a room we want
      // is missing, membership changed after the stream opened (a plan was just
      // created or joined) — reconnect so the server re-resolves it, rather
      // than silently never delivering that room.
      if (typeof info.heartbeat === 'number' && info.heartbeat > 0) {
        sseHeartbeatMs = info.heartbeat * 1000;
      }
      const served = new Set(info.rooms ?? []);
      let missing = false;
      desiredRooms.forEach((r) => {
        if (!served.has(r)) missing = true;
      });
      if (missing) scheduleSseRestart(500);
    } catch {
      /* a malformed ready frame is not worth dropping the stream for */
    }
  });

  // The server closes a stream periodically on purpose, so that authorisation
  // is re-resolved rather than trusted for the life of a tab. This is a normal
  // handover, not an error — reconnect at once and keep the UI on 'open'.
  source.addEventListener('cycle', () => {
    if (es !== source) return;
    stopSse();
    // Poll across the handover. It costs one or two requests and it means a
    // reconnect that fails to come back degrades to "slower" instead of
    // "nothing until you reload" — on a cadence every user hits.
    startPolling();
    scheduleSseRestart(50);
  });

  source.addEventListener('beat', () => {
    if (es !== source) return;
    noteSseActivity();     // proof of life: the reason it is an event, not a comment
  });

  source.addEventListener('chat', (ev) => {
    if (es !== source) return;
    if (sseSilences > 0) {
      sseSilences = 0;      // real traffic got through: this path is fine
      stopPolling();        // ...so the backstop can go
    }
    noteSseActivity();
    try {
      emit(JSON.parse((ev as MessageEvent).data) as ChatFrame);
    } catch {
      /* ignore a frame we cannot parse */
    }
  });

  source.addEventListener('fatal', () => {
    if (es !== source) return;   // a stale stream must not tear down the live one
    stopSse();
    setState('closed', 'Session expired — please sign in again');
  });

  // The server can refuse a stream for reasons that are not about the session —
  // too many already open for this account, for instance. Telling the user to
  // sign in again would be a lie and would leave chat dead; fall back instead.
  source.addEventListener('degraded', (ev) => {
    if (es !== source) return;
    let why = 'unavailable';
    try {
      why = String((JSON.parse((ev as MessageEvent).data) as { error?: string }).error ?? why);
    } catch {
      /* keep the default */
    }
    stopSse();
    transport = 'poll';
    setState('closed', `Live stream ${why} — using periodic refresh`);
    startPolling();
  });

  source.onerror = () => {
    if (es !== source) return;
    // We drive reconnection ourselves rather than letting EventSource retry:
    // its built-in retry replays the SAME url, and our ticket lives 60
    // seconds, so every automatic retry after that would be a guaranteed 401.
    const wasReady = sseReady;
    stopSse();
    if (wasReady) {
      // Established then dropped — normal. Poll covers the gap while we
      // reconnect with a fresh ticket.
      setState('connecting', null);
      startPolling();
      scheduleSseRestart(1_000);
      return;
    }
    sseFailures += 1;
    if (sseFailures >= 3) {
      transport = 'poll';
      setState('closed', 'Live stream unavailable — falling back to periodic refresh');
      startPolling();
      return;
    }
    scheduleSseRestart(1_000 * sseFailures);
  };
}

function scheduleSseRestart(delay: number): void {
  if (sseRetry) clearTimeout(sseRetry);
  sseRetry = setTimeout(() => {
    sseRetry = null;
    if (refs > 0 && transport === 'sse') void startSse();
  }, delay);
}

// ── delta poll: the last resort, and deliberately cheap ──────────────────────
/**
 * Only ever runs when no stream is open. Fetches just the messages that
 * arrived after the newest one already seen, which is an index range scan on
 * (room_id, created_at) — an empty poll costs a single index probe.
 *
 * Paused entirely while the tab is hidden, and fires immediately on focus, so
 * a backgrounded tab costs nothing at all.
 */
function pollDelay(): number {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return -1;
  if (state !== 'open') return POLL_ACTIVE_MS;
  // The stream says it is open. Normally that is enough and we do not poll at
  // all. But if a stream on THIS network path has already gone silent once,
  // "open" has been shown to mean nothing here — so keep a slow backstop until
  // a real message proves the path works. Trust is earned, not asserted.
  return sseSilences > 0 ? POLL_IDLE_MS : -1;
}

async function pollOnce(): Promise<void> {
  const rooms = Array.from(desiredRooms);
  if (!rooms.length) return;
  for (const roomId of rooms) {
    const after = pollCursor[roomId];
    const qs = new URLSearchParams({ limit: '50', mark_read: 'false' });
    if (after) qs.set('after', after);
    try {
      const res = await fetch(`/api/chat/rooms/${roomId}/messages?${qs.toString()}`, {
        headers: authHeaders(),
      });
      if (res.status === 401) {
        // Signed out or expired. Polling every 2s against a 401 forever is
        // exactly the kind of quiet battery drain nobody notices.
        stopPolling();
        setState('closed', 'Session expired — please sign in again');
        return;
      }
      if (!res.ok) continue;
      const body = (await res.json()) as { messages?: Array<Record<string, unknown>> };
      const list = body.messages ?? [];
      // Without a cursor the first pass is a baseline, not a delivery: emitting
      // 50 rows of history as if they were new would duplicate the whole
      // conversation on screen.
      const baseline = !after;
      for (const m of list) {
        const createdAt = String(m.created_at ?? '');
        if (createdAt > (pollCursor[roomId] ?? '')) pollCursor[roomId] = createdAt;
        if (baseline) continue;
        emit({
          type: 'room_message',
          room_id: roomId,
          message_id: String(m.id ?? ''),
          sender_id: String(m.sender_id ?? ''),
          from: String(m.sender_id ?? ''),
          sender_name: String(m.sender_name ?? 'Someone'),
          content: String(m.content ?? ''),
          content_type: String(m.content_type ?? 'text'),
          payload: (m.payload as Record<string, unknown> | null) ?? null,
          reply_to_id: (m.reply_to_id as string | null) ?? null,
          timestamp: createdAt,
        });
      }
    } catch {
      /* a failed poll is not fatal; the next tick tries again */
    }
  }
}

/** While polling, keep trying to get back onto the stream. A three-second API
 *  restart during a deploy used to pin the tab to 2-second polling until the
 *  user reloaded — permanently amber, and never marking anything read. */
let pollRecoverAt = 0;

function maybeRecoverStream(): void {
  if (transport !== 'poll' || refs === 0) return;
  const now = Date.now();
  if (now < pollRecoverAt) return;
  pollRecoverAt = now + 30_000;      // at most one attempt every 30s
  sseFailures = 0;
  transport = 'sse';
  void startSse().then(() => {
    // If the attempt never got off the ground, hand the tab back to polling —
    // otherwise `transport` stays 'sse', `maybeRecoverStream` guards itself out
    // and the recovery logic disarms permanently.
    if (state !== 'open' && !sseStarting && es === null && polling) transport = 'poll';
  });
}

function schedulePoll(): void {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  if (!polling || refs === 0) return;
  const delay = pollDelay();
  if (delay < 0) {
    // Hidden tab, or a stream is live. Idle-check occasionally rather than
    // spinning, so waking up is instant but costs nothing meanwhile.
    pollTimer = setTimeout(schedulePoll, POLL_IDLE_MS);
    return;
  }
  pollTimer = setTimeout(async () => {
    await pollOnce();
    maybeRecoverStream();
    schedulePoll();
  }, delay);
}

function onVisibility(): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    if (polling) {
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = setTimeout(async () => {
        await pollOnce();
        schedulePoll();
      }, 0);
    }
    // A stream that dropped while the tab was hidden should come back now.
    if (transport === 'sse' && !sseReady && refs > 0) void startSse();
  }
}

function startPolling(): void {
  if (polling) return;
  polling = true;
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);
  }
  schedulePoll();
}

function stopPolling(): void {
  polling = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', onVisibility);
  }
}

/** Seed the poll cursor so a fallback never replays messages already on screen. */
export function noteMessageSeen(roomId: string, createdAt: string): void {
  // Server timestamps only. Seeding this from `new Date()` on the device would
  // let a clock that runs fast silently swallow every message written in the
  // interval — the poll asks for `created_at > cursor`, and the server's clock
  // is the only one that wrote those rows.
  if (!roomId || !createdAt) return;
  if (createdAt > (pollCursor[roomId] ?? '')) pollCursor[roomId] = createdAt;
}

// ── native WebSocket (rollback path, unchanged behaviour) ────────────────────
function clearNativeTimers(): void {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  if (retry) {
    clearTimeout(retry);
    retry = null;
  }
}

function openNativeSocket(): void {
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
    desiredRooms.forEach((roomId) =>
      sock.send(JSON.stringify({ action: 'join_room', room_id: roomId })),
    );
  };

  sock.onmessage = (evt) => {
    let frame: ChatFrame;
    try {
      frame = JSON.parse(evt.data as string) as ChatFrame;
    } catch {
      return;
    }
    if (frame.type === 'pong') return;
    emit(frame);
  };

  sock.onerror = () => setState(state, 'Connection error');

  sock.onclose = (evt) => {
    if (ws !== sock) return;
    clearNativeTimers();
    ws = null;
    if (intentionalClose) {
      setState('closed', null);
      return;
    }
    if (evt.code === 4001) {
      setState('closed', 'Session expired — please sign in again');
      return;
    }
    setState('closed', lastError);
    if (refs > 0) {
      const wait = backoff;
      backoff = Math.min(wait * 2, BACKOFF_MAX_MS);
      retry = setTimeout(openNativeSocket, wait);
    }
  };
}

function stopNativeSocket(): void {
  intentionalClose = true;
  clearNativeTimers();
  const sock = ws;
  ws = null;
  if (sock && (sock.readyState === WebSocket.OPEN || sock.readyState === WebSocket.CONNECTING)) {
    sock.close(1000, 'released');
  }
}

// ── lifecycle ────────────────────────────────────────────────────────────────
async function boot(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!localStorage.getItem('pal_token')) {
    setState('closed', 'Not signed in');
    return;
  }

  const cfg = await fetchRealtimeConfig();
  if (refs === 0) return; // everyone released while we were asking

  // Centrifugo first when it is actually configured — it is the path built for
  // 1M concurrent sockets. But it is NOT trusted blindly: if it cannot reach
  // 'open' quickly, we fall through rather than leaving the user staring at a
  // conversation that never updates.
  if (cfg && cfg.transport === 'centrifugo' && cfg.url) {
    transport = 'centrifugo';
    await startCentrifugo(cfg.url, cfg.user_channel);
    if (centProbe) clearTimeout(centProbe);
    centProbe = setTimeout(() => {
      centProbe = null;
      if (refs > 0 && transport === 'centrifugo' && state !== 'open') {
        console.warn('[chat] Centrifugo did not connect — falling back to SSE');
        stopCentrifugo();
        transport = 'sse';
        void startSse();
      }
    }, TRANSPORT_PROBE_MS);
    return;
  }

  // Default. Plain HTTP, through the proxy that already works.
  transport = 'sse';
  await startSse();
}

function teardown(): void {
  if (centProbe) {
    clearTimeout(centProbe);
    centProbe = null;
  }
  // Every transport, not just the current one: a fall-back leaves the previous
  // one half-built, and a leaked EventSource keeps reconnecting forever after
  // the last consumer is gone.
  stopCentrifugo();
  stopSse();
  stopNativeSocket();
  stopPolling();
  pollCursor = {};
  desiredRooms.clear();
  bootPromise = null;
  sseSilences = 0;
  sseFailures = 0;
  transport = 'unknown';
  setState('idle', null);
}

/** Acquire the shared transport. Returns a release function. */
export function acquireChatSocket(): () => void {
  refs += 1;
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  if (!bootPromise) {
    bootPromise = boot().catch((err) => {
      setState('closed', String(err));
    });
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    refs = Math.max(0, refs - 1);
    if (refs === 0) {
      releaseTimer = setTimeout(() => {
        releaseTimer = null;
        if (refs === 0) teardown();
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

export function onChatState(
  fn: (s: ConnectionState, err: string | null) => void,
): () => void {
  stateListeners.add(fn);
  fn(state, lastError);
  return () => {
    stateListeners.delete(fn);
  };
}

export function getChatState(): { state: ConnectionState; lastError: string | null } {
  return { state, lastError };
}

export function getTransport(): Transport {
  return transport;
}

/**
 * Send a raw frame.
 *
 * Under Centrifugo this returns FALSE for anything but a ping, because clients
 * are not allowed to publish — that is deliberate, not a limitation. Every
 * caller already falls back to POST /chat/send, which is the path that
 * persists, authorises and redacts. Do not "fix" this by enabling client
 * publish in the Centrifugo namespace config: it would let a client put an
 * unredacted frame into a family hub.
 */
export function sendChatFrame(frame: Record<string, unknown>): boolean {
  // Centrifugo forbids client publish by design; SSE and polling are one-way
  // by nature. In all three the caller falls back to POST /chat/send, which is
  // the path that persists, authorises and PHI-redacts. That fallback already
  // existed for flaky sockets, so no call site needed changing.
  if (transport === 'centrifugo' || transport === 'sse' || transport === 'poll') {
    return false;
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(frame));
  return true;
}

export function joinChatRoom(roomId: string): boolean {
  const isNew = !desiredRooms.has(roomId);
  desiredRooms.add(roomId);
  if (transport === 'centrifugo') {
    return !!subscribeRoomChannel(`room:${roomId}`);
  }
  if (transport === 'poll') {
    // The poll reads desiredRooms live, so adding it above is the whole job.
    return true;
  }
  if (transport === 'sse') {
    // The SSE endpoint resolves the user's rooms ONCE, when the stream opens.
    // A room joined afterwards (accepting an invite, creating a second plan)
    // would therefore deliver nothing for the life of that stream. Restart so
    // the server re-resolves — cheap, and only when the room is genuinely new.
    if (isNew) scheduleSseRestart(0);
    return true;
  }
  return sendChatFrame({ action: 'join_room', room_id: roomId });
}

export function leaveChatRoom(roomId: string): boolean {
  desiredRooms.delete(roomId);
  delete pollCursor[roomId];
  if (transport === 'sse' || transport === 'poll') return true;
  if (transport === 'centrifugo') {
    const channel = `room:${roomId}`;
    const sub = roomSubs.get(channel);
    if (!sub) return false;
    try {
      sub.unsubscribe();
      centrifuge?.removeSubscription(sub);
    } catch {
      /* ignore */
    }
    roomSubs.delete(channel);
    return true;
  }
  return sendChatFrame({ action: 'leave_room', room_id: roomId });
}

/** Force a reconnect — call after sign-in so the new token is picked up. */
export function reconnectChatSocket(): void {
  const hadRefs = refs;
  teardown();
  if (hadRefs > 0) {
    bootPromise = boot().catch((err) => setState('closed', String(err)));
  }
}

// ── cross-component badge events ─────────────────────────────────────────────
export const CHAT_READ_EVENT = 'pal:chat-read';

export function announceChatRead(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CHAT_READ_EVENT));
  }
}
