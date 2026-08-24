/**
 * SarvamVoiceClient — browser/WebView half of the PAL voice call.
 *
 * Same file runs in three places:
 *   * the Next.js web app (import it, or drop in /public),
 *   * the Capacitor WebView on iOS and Android,
 *   * a plain browser tab for testing.
 *
 * Audio in : mic -> AudioWorklet -> 16-bit PCM @16 kHz -> WebSocket (binary)
 * Audio out: WebSocket (binary PCM) -> scheduled AudioBufferSourceNodes
 *
 * Barge-in is detected locally from the mic RMS while PAL is speaking: we stop
 * playback immediately (feels instant) and tell the server, which kills the TTS
 * stream so no further audio arrives.
 */
/** 20 samples @16 kHz — below this a frame is truncation, not audio. */
const MIN_AUDIO_FRAME_BYTES = 40;

export class SarvamVoiceClient extends EventTarget {
  constructor({ apiBase = '', sampleRate = 16000 } = {}) {
    super();
    this.apiBase = apiBase.replace(/\/$/, '');
    this.sampleRate = sampleRate;
    this.ws = null;
    this.ctxIn = null;
    this.ctxOut = null;
    this.node = null;
    this.stream = null;
    this.sources = new Set();
    this.playCursor = 0;
    this.state = 'idle';
    this.agentSpeaking = false;
    this.muted = false;
    this.loudFrames = 0;
    this.lastInterrupt = 0;
    this.session = null;
    this.endedEmitted = false;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  setState(state) {
    this.state = state;
    this.emit('state', state);
  }

  /** Ask the backend for a session + short-lived call token. */
  async createSession({ patientId, language, gender = 'female', context = {} }) {
    const r = await fetch(`${this.apiBase}/api/voice/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patient_id: patientId,
        language,
        gender,
        platform: 'web',
        context,
      }),
    });
    if (!r.ok) throw new Error(`session create failed: ${r.status}`);
    this.session = await r.json();
    return this.session;
  }

  async connect({ patientId, language, gender = 'female', context = {}, session = null }) {
    this.session = session || (await this.createSession({ patientId, language, gender, context }));

    try { if (navigator.mediaDevices?.getUserMedia) await this.startMic(); } catch (err) { console.warn("[Sarvam] Microphone not available (HTTP mode):", err.message); }
    this.ctxOut = this.makeContext();
    await this.ctxOut.resume();
    this.playCursor = this.ctxOut.currentTime;

    const base = this.apiBase || location.origin;
    
    const wsUrl = base.replace(/^http/, 'ws') + this.session.ws_path;
    console.log("[Sarvam] Connecting to:", wsUrl);
    this.ws = new WebSocket(wsUrl);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.ws.send(
        JSON.stringify({ type: 'start', language, gender, context })
      );
      this.setState('connecting');
    };
    this.ws.onmessage = (e) => this.onMessage(e);
    this.ws.onerror = () => this.emit('error', 'connection error');
    this.ws.onclose = () => {
      this.setState('ended');
      this.teardown();
      if (!this.endedEmitted) {
        // Socket died without a farewell (network drop, server restart) — the UI
        // still needs to leave the call screen.
        this.endedEmitted = true;
        this.emit('ended', {});
      }
    };
    return this.session;
  }

  onMessage(event) {
    if (event.data instanceof ArrayBuffer) {
      this.enqueueAudio(event.data);
      return;
    }
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    switch (msg.type) {
      case 'ready':
        this.emit('ready', msg);
        this.setState('listening');
        break;
      case 'state':
        this.agentSpeaking = msg.value === 'speaking';
        this.setState(msg.value);
        break;
      case 'transcript':
        this.emit('transcript', msg);
        break;
      case 'agent':
        this.emit('agent', msg);
        break;
      case 'language':
        this.emit('language', msg);
        break;
      case 'clear':
        this.stopPlayback();
        break;
      case 'ended':
        this.endedEmitted = true;
        this.emit('ended', msg.summary || {});
        break;
      case 'error':
        this.emit('error', msg.message);
        break;
    }
  }

  // ── mic ────────────────────────────────────────────────────────────────────
  /** Some browsers reject an explicit sampleRate; the worklet resamples anyway. */
  makeContext() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    try {
      return new Ctx({ sampleRate: this.sampleRate });
    } catch {
      return new Ctx();
    }
  }

  async startMic() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,   // essential: stops PAL hearing itself
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.ctxIn = this.makeContext();
    await this.ctxIn.resume();
    await this.ctxIn.audioWorklet.addModule(
      new URL('./worklets/pcm-recorder.js', import.meta.url)
    );
    const src = this.ctxIn.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctxIn, 'pcm-recorder');
    this.node.port.onmessage = ({ data }) => this.onMicFrame(data);
    src.connect(this.node);
    // Keep the graph alive without routing mic to speakers.
    const sink = this.ctxIn.createGain();
    sink.gain.value = 0;
    this.node.connect(sink).connect(this.ctxIn.destination);
  }

  onMicFrame({ pcm, rms }) {
    this.emit('level', rms);
    if (this.ws && this.ws.readyState === WebSocket.OPEN && !this.muted) {
      this.ws.send(pcm);
    }
    // Local barge-in: ~120 ms of speech-level energy while PAL is talking.
    if (this.agentSpeaking && !this.muted) {
      this.loudFrames = rms > 0.035 ? this.loudFrames + 1 : 0;
      if (this.loudFrames >= 6 && Date.now() - this.lastInterrupt > 700) {
        this.loudFrames = 0;
        this.lastInterrupt = Date.now();
        this.interrupt();
      }
    } else {
      this.loudFrames = 0;
    }
  }

  interrupt() {
    this.stopPlayback();
    this.agentSpeaking = false;
    this.emit('interrupt');
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'interrupt' }));
    }
  }

  // ── playback ───────────────────────────────────────────────────────────────
  enqueueAudio(arrayBuffer) {
    if (!this.ctxOut || !arrayBuffer || !arrayBuffer.byteLength) return;
    // Int16Array requires an even byte length; a truncated frame must not throw.
    // Anything under ~1 ms of audio is a fragment, not speech — scheduling it
    // just adds a click and an extra source to track.
    const usable = arrayBuffer.byteLength - (arrayBuffer.byteLength % 2);
    if (usable < MIN_AUDIO_FRAME_BYTES) return;
    const pcm = new Int16Array(arrayBuffer, 0, usable / 2);
    if (!pcm.length) return;
    // Playback runs at the output context's real rate, which may not be the rate
    // we asked for.
    const rate = this.ctxOut.sampleRate || this.sampleRate;
    const buf = this.ctxOut.createBuffer(1, pcm.length, rate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;

    if (this.ctxOut.state === 'closed') return;
    const src = this.ctxOut.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctxOut.destination);
    // 60 ms of slack absorbs network jitter without audible lag.
    const startAt = Math.max(this.ctxOut.currentTime + 0.06, this.playCursor);
    src.start(startAt);
    this.playCursor = startAt + buf.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  stopPlayback() {
    for (const src of this.sources) {
      try { src.stop(); } catch { /* already finished */ }
    }
    this.sources.clear();
    this.playCursor = this.ctxOut ? this.ctxOut.currentTime : 0;
  }

  // ── controls ───────────────────────────────────────────────────────────────
  setMuted(muted) {
    this.muted = muted;
    if (this.node) this.node.port.postMessage({ type: 'mute', value: muted });
    this.emit('muted', muted);
  }

  sendText(text) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'text', text }));
    }
  }

  hangup() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'hangup' }));
    }
    this.teardown();
    this.setState('ended');
  }

  teardown() {
    this.stopPlayback();
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.node) this.node.disconnect();
    for (const ctx of [this.ctxIn, this.ctxOut]) {
      if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {});
    }
    this.stream = this.node = this.ctxIn = this.ctxOut = null;
    if (this.ws && this.ws.readyState <= 1) this.ws.close();
    this.ws = null;
  }
}
