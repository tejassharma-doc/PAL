'use client';

import { useState, useEffect } from 'react';
import { VoiceChatClient } from '../../lib/voice-chat-client';

export default function VoiceTestPage() {
  const [client, setClient] = useState<VoiceChatClient | null>(null);
  const [state, setState] = useState<string>('idle');
  const [transcript, setTranscript] = useState<string>('');
  const [agentResponse, setAgentResponse] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isConnected, setIsConnected] = useState(false);

  const startCall = async () => {
    try {
      if (typeof window === 'undefined') return;

      const patientId = localStorage.getItem('pal_patient_id');
      if (!patientId) {
        setError('Please login first');
        return;
      }

      const voiceClient = new VoiceChatClient({
        patientId,
        language: 'auto',
        gender: 'female',
        onStateChange: (newState) => {
          console.log('State changed:', newState);
          setState(newState);
        },
        onTranscript: (text, final) => {
          console.log('Transcript:', text, 'Final:', final);
          if (final) {
            setTranscript(prev => prev + '\nYou: ' + text);
          }
        },
        onAgentResponse: (text) => {
          console.log('Agent:', text);
          setAgentResponse(prev => prev + '\nAssistant: ' + text);
        },
        onError: (err) => {
          console.error('Voice error:', err);
          setError(err);
        }
      });

      await voiceClient.connect();
      setClient(voiceClient);
      setIsConnected(true);
      setError('');

    } catch (err) {
      console.error('Failed to start call:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect');
    }
  };

  const hangup = () => {
    client?.hangup();
    setClient(null);
    setIsConnected(false);
    setState('idle');
  };

  const interrupt = () => {
    client?.interrupt();
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow p-6">
        <h1 className="text-2xl font-bold mb-4">Voice Chat Test</h1>

        {/* Error Display */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded text-red-700">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* State Display */}
        <div className="mb-4 p-4 bg-blue-50 rounded">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${
              state === 'listening' ? 'bg-green-500 animate-pulse' :
              state === 'thinking' ? 'bg-yellow-500 animate-pulse' :
              state === 'speaking' ? 'bg-blue-500 animate-pulse' :
              'bg-gray-400'
            }`}></div>
            <span className="font-semibold capitalize">{state}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="mb-6 flex gap-3">
          {!isConnected ? (
            <button
              onClick={startCall}
              className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold"
            >
              Start Voice Call
            </button>
          ) : (
            <>
              <button
                onClick={interrupt}
                className="px-6 py-3 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 font-semibold"
              >
                Interrupt
              </button>
              <button
                onClick={hangup}
                className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 font-semibold"
              >
                Hang Up
              </button>
            </>
          )}
        </div>

        {/* Transcript */}
        <div className="mb-4">
          <h2 className="text-lg font-semibold mb-2">Your Speech:</h2>
          <div className="p-4 bg-gray-50 rounded border min-h-[100px] whitespace-pre-wrap">
            {transcript || 'Speak to see transcript...'}
          </div>
        </div>

        {/* Agent Response */}
        <div>
          <h2 className="text-lg font-semibold mb-2">Assistant Response:</h2>
          <div className="p-4 bg-blue-50 rounded border min-h-[100px] whitespace-pre-wrap">
            {agentResponse || 'Assistant responses will appear here...'}
          </div>
        </div>

        {/* Debug Info */}
        <div className="mt-6 p-4 bg-gray-100 rounded text-sm">
          <strong>Debug Info:</strong>
          <ul className="mt-2 space-y-1">
            <li>Connected: {isConnected ? 'Yes' : 'No'}</li>
            <li>State: {state}</li>
            <li>Patient ID: {typeof window !== 'undefined' ? localStorage.getItem('pal_patient_id')?.substring(0, 8) : 'N/A'}...</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
