'use client';

/**
 * PAL chat socket hook — adapted from realtime-chat-kit/frontend/useChatSocket.js.
 *
 * Thin wrapper over the shared singleton in lib/chatSocket.ts. The public API is
 * unchanged from the first version of this file, so existing callers need no
 * edits — but there is now exactly ONE WebSocket per browser tab no matter how
 * many components call this hook (the Family Hub button in the AppBar renders on
 * nearly every screen).
 *
 * PAL-specific adaptations live in lib/chatSocket.ts:
 *   - the socket cannot go through the Next `/api/...` proxy (a Route Handler
 *     cannot proxy a WebSocket upgrade), so it connects to the API origin
 *   - reactStrictMode double-mount is harmless: refcounting + a release grace
 *     period mean mount → unmount → mount reuses the same connection
 *   - the token is read from localStorage `pal_token` at connect time
 */
import { useCallback, useEffect, useState } from 'react';
import {
  acquireChatSocket,
  getChatState,
  joinChatRoom,
  leaveChatRoom,
  onChatFrame,
  onChatState,
  sendChatFrame,
  type ChatFrame,
  type ConnectionState,
} from './chatSocket';

export type { ChatFrame, ConnectionState };

export interface ChatMessageFrame extends ChatFrame {
  type: 'room_message';
  room_id: string;
  message_id: string;
  from: string;
  sender_id: string;
  sender_name?: string;
  sender_role?: string | null;
  sender_avatar?: string | null;
  content: string;
  content_type?: string;
  payload?: Record<string, unknown> | null;
  reply_to_id?: string | null;
  timestamp: string;
}

export { chatSocketUrl } from './chatSocket';

export function useChatSocket(opts: { enabled?: boolean } = {}) {
  const enabled = opts.enabled !== false;

  const [state, setState] = useState<ConnectionState>(() => getChatState().state);
  const [lastError, setLastError] = useState<string | null>(() => getChatState().lastError);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const release = acquireChatSocket();
    const unsubState = onChatState((s, err) => {
      setState(s);
      setLastError(err);
    });
    return () => {
      unsubState();
      release();
    };
  }, [enabled]);

  const onMessage = useCallback((fn: (f: ChatFrame) => void) => onChatFrame(fn), []);

  const joinRoom = useCallback((roomId: string) => joinChatRoom(roomId), []);
  const leaveRoom = useCallback((roomId: string) => leaveChatRoom(roomId), []);
  const sendRoom = useCallback(
    (roomId: string, content: string, replyToId?: string) =>
      sendChatFrame({ action: 'room_message', room_id: roomId, content, reply_to_id: replyToId }),
    [],
  );
  const sendDM = useCallback((to: string, content: string) => sendChatFrame({ action: 'dm', to, content }), []);
  const typing = useCallback(
    (target: { room_id?: string; to?: string }) => sendChatFrame({ action: 'typing', ...target }),
    [],
  );
  const react = useCallback(
    (roomId: string, messageId: string, reaction = 'like') =>
      sendChatFrame({ action: 'react', room_id: roomId, message_id: messageId, reaction }),
    [],
  );
  const markRead = useCallback(
    (messageId: string) => sendChatFrame({ action: 'read', message_id: messageId }),
    [],
  );

  return {
    state,
    connected: state === 'open',
    lastError,
    onMessage,
    joinRoom,
    leaveRoom,
    sendRoom,
    sendDM,
    typing,
    react,
    markRead,
    send: sendChatFrame,
  };
}
