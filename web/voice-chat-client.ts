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
  private mediaRecorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private options: VoiceChatOptions;

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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Create AudioContext for audio processing
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      const source = this.audioContext.createMediaStreamSource(stream);

      // Use MediaRecorder to capture audio
      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm',
      });

      this.mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0 && this.ws?.readyState === WebSocket.OPEN) {
          // Convert to PCM and send
          const arrayBuffer = await event.data.arrayBuffer();
          const pcm = await this.convertToPCM(arrayBuffer);
          this.ws.send(pcm);
        }
      };

      this.mediaRecorder.start(100); // Send chunks every 100ms
      console.log('[VoiceChat] Audio capture started');

    } catch (error) {
      console.error('[VoiceChat] Microphone access error:', error);
      this.options.onError?.('Failed to access microphone');
    }
  }

  private async convertToPCM(audioData: ArrayBuffer): Promise<ArrayBuffer> {
    // For now, send raw data - proper PCM conversion would go here
    // In production, you'd decode the audio and convert to 16-bit PCM @ 16kHz
    return audioData;
  }

  private playAudio(pcmData: ArrayBuffer): void {
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
    source.start();
  }

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case 'ready':
        console.log('[VoiceChat] Ready:', msg);
        this.options.onStateChange?.('listening');
        break;

      case 'state':
        console.log('[VoiceChat] State:', msg.value);
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
    if (this.mediaRecorder?.state !== 'inactive') {
      this.mediaRecorder?.stop();
    }

    this.mediaRecorder?.stream?.getTracks().forEach(track => track.stop());

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.close();
    }

    this.audioContext?.close();

    this.ws = null;
    this.mediaRecorder = null;
    this.audioContext = null;
  }
}
