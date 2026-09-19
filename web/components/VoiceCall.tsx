'use client';

import { useEffect, useState, useRef } from 'react';
import { VoiceChatClient } from '../lib/voice-chat-client';

interface VoiceCallProps {
  patientId: string;
  onClose: () => void;
}

export default function VoiceCall({ patientId, onClose }: VoiceCallProps) {
  const [state, setState] = useState<string>('idle');
  const [transcript, setTranscript] = useState<string>('');
  const [agentResponse, setAgentResponse] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isConnected, setIsConnected] = useState(false);
  const clientRef = useRef<VoiceChatClient | null>(null);

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (clientRef.current) {
        clientRef.current.hangup();
      }
    };
  }, []);

  const startCall = async () => {
    if (typeof window === 'undefined') return;

    try {
      setState('connecting');
      setError('');

      const voiceClient = new VoiceChatClient({
        patientId,
        language: 'auto',
        gender: 'female',
        onStateChange: (newState) => {
          setState(newState);
        },
        onTranscript: (text, final) => {
          if (final) {
            setTranscript(prev => prev + '\nYou: ' + text);
          }
        },
        onAgentResponse: (text) => {
          setAgentResponse(prev => prev + '\nAssistant: ' + text);
        },
        onError: (err) => {
          setError(err);
          setState('error');
        }
      });

      await voiceClient.connect();
      clientRef.current = voiceClient;
      setIsConnected(true);
      setState('connected');

    } catch (err) {
      console.error('Failed to start call:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect');
      setState('idle');
    }
  };

  const endCall = () => {
    if (clientRef.current) {
      clientRef.current.hangup();
    }
    clientRef.current = null;
    setIsConnected(false);
    setState('ended');
  };

  const interrupt = () => {
    if (clientRef.current) {
      clientRef.current.interrupt();
    }
  };

  const getStateDisplay = (state: string) => {
    const stateMap: Record<string, string> = {
      idle: 'Ready',
      connecting: 'Connecting...',
      connected: 'Connected',
      listening: '🎤 Listening...',
      thinking: '🤔 Processing...',
      speaking: '🔊 AI Speaking...',
      ended: 'Call Ended',
      error: 'Error'
    };
    return stateMap[state] || state;
  };

  const getStateColor = (state: string) => {
    if (state === 'listening') return 'text-green-600';
    if (state === 'thinking') return 'text-yellow-600';
    if (state === 'speaking') return 'text-blue-600';
    if (state === 'connected' || state === 'connecting') return 'text-yellow-600';
    if (state === 'ended') return 'text-gray-600';
    if (state === 'error') return 'text-red-600';
    return 'text-gray-900';
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Hermes AI Call</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* State Display */}
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${
              state === 'listening' ? 'bg-green-500 animate-pulse' :
              state === 'thinking' ? 'bg-yellow-500 animate-pulse' :
              state === 'speaking' ? 'bg-blue-500 animate-pulse' :
              state === 'connecting' ? 'bg-yellow-500 animate-pulse' :
              'bg-gray-400'
            }`}></div>
            <span className={`font-semibold ${getStateColor(state)}`}>
              {getStateDisplay(state)}
            </span>
          </div>
        </div>

        {/* Transcript */}
        {transcript && (
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Your Speech:</h3>
            <div className="p-3 bg-blue-50 rounded text-sm max-h-32 overflow-y-auto whitespace-pre-wrap">
              {transcript}
            </div>
          </div>
        )}

        {/* Agent Response */}
        {agentResponse && (
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">AI Response:</h3>
            <div className="p-3 bg-green-50 rounded text-sm max-h-32 overflow-y-auto whitespace-pre-wrap">
              {agentResponse}
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="flex gap-3">
          {!isConnected ? (
            <button
              onClick={startCall}
              disabled={state === 'connecting'}
              className="flex-1 bg-green-600 text-white py-3 px-4 rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-semibold"
            >
              {state === 'connecting' ? 'Connecting...' : '📞 Start Call'}
            </button>
          ) : (
            <>
              {state === 'speaking' && (
                <button
                  onClick={interrupt}
                  className="flex-1 bg-yellow-600 text-white py-3 px-4 rounded-lg hover:bg-yellow-700 font-semibold"
                >
                  ✋ Interrupt
                </button>
              )}
              <button
                onClick={endCall}
                className="flex-1 bg-red-600 text-white py-3 px-4 rounded-lg hover:bg-red-700 font-semibold"
              >
                📞 End Call
              </button>
            </>
          )}
        </div>

        {/* Info */}
        <div className="mt-4 text-xs text-gray-500 text-center">
          Powered by Hermes AI • STT/TTS via Sarvam • Gemma 4
        </div>
      </div>
    </div>
  );
}
