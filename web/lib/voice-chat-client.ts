/**
 * Voice Chat Client
 *
 * WebSocket client for voice conversations with STT/TTS + Hermes integration
 */

export interface VoiceChatOptions {
  patientId: string;
  language?: string;
  gender?: 'male' | 'female';
  onStateChange?: (state: 'idle' | 'listening' | 'thinking' | 'speaking') => void;
  onTranscript?: (text: string, final: boolean) => void;
  onAgentResponse?: (text: string) => void;
  onError?: (error: string) => void;
}

export class VoiceChatClient {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private token: string | null = null;
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private options: VoiceChatOptions;
  private audioQueue: ArrayBuffer[] = [];
  private isPlayingAudio: boolean = false;
  private currentState: string = 'idle';  // Track current state
  private micMuted: boolean = false;  // Track microphone mute state independently

  constructor(options: VoiceChatOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    try {
      // 1. Create session
      const sessionResponse = await fetch('/api/voice-chat/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('pal_token')}`
        },
        body: JSON.stringify({
          patient_id: this.options.patientId,
          language: this.options.language || 'auto',
          gender: this.options.gender || 'female'
        })
      });

      if (!sessionResponse.ok) {
        throw new Error(`Failed to create session: ${sessionResponse.statusText}`);
      }

      const session = await sessionResponse.json();
      this.sessionId = session.session_id;
      this.token = session.token;

      // 2. Connect WebSocket
      const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}${session.ws_url}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        console.log('[VoiceChat] WebSocket connected');
        this.startAudioCapture();
      };

      this.ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          // Binary audio data - play it
          this.playAudio(event.data);
        } else {
          // JSON event
          try {
            const msg = JSON.parse(event.data);
            this.handleMessage(msg);
          } catch (e) {
            console.error('[VoiceChat] Failed to parse message:', e);
          }
        }
      };

      this.ws.onerror = (error) => {
        console.error('[VoiceChat] WebSocket error:', error);
        this.options.onError?.('WebSocket connection error');
      };

      this.ws.onclose = () => {
        console.log('[VoiceChat] WebSocket closed');
        this.cleanup();
      };

    } catch (error) {
      console.error('[VoiceChat] Connection error:', error);
      this.options.onError?.(error instanceof Error ? error.message : 'Connection failed');
      throw error;
    }
  }

  private async startAudioCapture(): Promise<void> {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Create AudioContext @ 16kHz for STT compatibility
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Use ScriptProcessor to capture raw PCM audio
      const bufferSize = 4096;
      this.scriptProcessor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

      this.scriptProcessor.onaudioprocess = (event) => {
        if (this.ws?.readyState !== WebSocket.OPEN) return;

        // IMPORTANT: Don't send audio while:
        // 1. AI is thinking or speaking (state-based)
        // 2. Audio is still playing from speakers (playback-based)
        // This prevents acoustic echo (microphone picking up speaker output)
        if (this.micMuted || this.isPlayingAudio || this.currentState === 'thinking') {
          return;  // Mute microphone during AI activity
        }

        // Get audio samples (already at 16kHz mono from AudioContext)
        const inputData = event.inputBuffer.getChannelData(0);

        // Convert float32 [-1, 1] to int16 PCM
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Send raw PCM bytes
        this.ws.send(pcmData.buffer);
      };

      // Connect: source → processor → destination
      source.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.audioContext.destination);

      console.log('[VoiceChat] Audio capture started (PCM 16kHz)');

    } catch (error) {
      console.error('[VoiceChat] Microphone access error:', error);
      this.options.onError?.('Failed to access microphone');
    }
  }

  private playAudio(pcmData: ArrayBuffer): void {
    // Add to queue
    this.audioQueue.push(pcmData);

    // Start playing if not already playing
    if (!this.isPlayingAudio) {
      this.playNextInQueue();
    }
  }

  private async playNextInQueue(): Promise<void> {
    if (this.audioQueue.length === 0) {
      this.isPlayingAudio = false;

      // IMPORTANT: Only unmute mic when audio playback is FULLY complete
      // Add small delay to ensure speaker output has finished
      setTimeout(() => {
        if (!this.isPlayingAudio && this.currentState === 'listening') {
          this.micMuted = false;
          console.log('[VoiceChat] Mic UNMUTED (audio complete)');
        }
      }, 500);  // 500ms delay after last audio chunk

      return;
    }

    this.isPlayingAudio = true;
    const pcmData = this.audioQueue.shift()!;

    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: 16000 });
    }

    // Decode PCM and play
    const int16Array = new Int16Array(pcmData);
    const float32Array = new Float32Array(int16Array.length);

    // Convert int16 to float32
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }

    // Create audio buffer
    const audioBuffer = this.audioContext.createBuffer(1, float32Array.length, 16000);
    audioBuffer.getChannelData(0).set(float32Array);

    // Play
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);

    // When this chunk finishes, play the next one
    source.onended = () => {
      this.playNextInQueue();
    };

    source.start();
  }

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case 'ready':
        console.log('[VoiceChat] Ready:', msg);
        this.currentState = 'listening';
        this.micMuted = false;  // Unmute mic when ready
        this.options.onStateChange?.('listening');
        break;

      case 'state':
        console.log('[VoiceChat] State:', msg.value);
        this.currentState = msg.value;

        // Mute mic when AI starts thinking
        if (msg.value === 'thinking') {
          this.micMuted = true;
          console.log('[VoiceChat] Mic MUTED (thinking)');
        }
        // Don't unmute yet when state becomes 'speaking' - wait for audio to finish
        // Don't unmute yet when state becomes 'listening' - wait for audio queue to drain

        this.options.onStateChange?.(msg.value);
        break;

      case 'transcript':
        console.log('[VoiceChat] Transcript:', msg.text);
        this.options.onTranscript?.(msg.text, msg.final);
        break;

      case 'agent':
        console.log('[VoiceChat] Agent response:', msg.text);
        this.options.onAgentResponse?.(msg.text);
        break;

      case 'clear':
        // Clear audio buffer (barge-in)
        console.log('[VoiceChat] Audio cleared (interrupt)');
        break;

      case 'error':
        console.error('[VoiceChat] Server error:', msg.message);
        this.options.onError?.(msg.message);
        break;

      case 'ended':
        console.log('[VoiceChat] Call ended');
        this.cleanup();
        break;

      default:
        console.log('[VoiceChat] Unknown message:', msg);
    }
  }

  interrupt(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'interrupt' }));
    }
  }

  hangup(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'hangup' }));
    }
    this.cleanup();
  }

  private cleanup(): void {
    // Disconnect audio processing
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }

    // Stop media stream tracks
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    // Close WebSocket
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.close();
    }

    // Close audio context
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.ws = null;
  }
}
