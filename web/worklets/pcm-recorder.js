/**
 * PCM recorder worklet.
 *
 * Runs on the audio render thread so mic capture never stutters when the UI is
 * busy. Does three jobs:
 *   1. resamples to 16 kHz when the AudioContext could not be opened at 16 k
 *      (Safari sometimes ignores the requested rate),
 *   2. converts float32 -> 16-bit LE PCM in 20 ms frames (320 samples),
 *   3. reports a smoothed RMS so the main thread can detect barge-in locally,
 *      without waiting for the server's VAD.
 */
const TARGET_RATE = 16000;
const FRAME_SAMPLES = 320; // 20 ms @ 16 kHz

class PcmRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ratio = sampleRate / TARGET_RATE;
    this.buffer = new Float32Array(FRAME_SAMPLES);
    this.filled = 0;
    this.readPos = 0;
    this.tail = new Float32Array(0);
    this.rms = 0;
    this.muted = false;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'mute') this.muted = !!e.data.value;
    };
  }

  /** Linear-interpolation resample. Cheap, and at 48k->16k it is inaudible. */
  resample(input) {
    if (this.ratio === 1) return input;
    const merged = new Float32Array(this.tail.length + input.length);
    merged.set(this.tail, 0);
    merged.set(input, this.tail.length);

    const outLen = Math.floor((merged.length - this.readPos) / this.ratio);
    const out = new Float32Array(Math.max(outLen, 0));
    let pos = this.readPos;
    for (let i = 0; i < out.length; i++) {
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const a = merged[idx] || 0;
      const b = merged[idx + 1] !== undefined ? merged[idx + 1] : a;
      out[i] = a + (b - a) * frac;
      pos += this.ratio;
    }
    const consumed = Math.floor(pos);
    this.tail = merged.slice(Math.min(consumed, merged.length));
    this.readPos = pos - consumed;
    return out;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    let sum = 0;
    for (let i = 0; i < channel.length; i++) sum += channel[i] * channel[i];
    const frameRms = Math.sqrt(sum / channel.length);
    // Fast attack, slow release: reacts to speech onset, ignores clicks.
    this.rms = frameRms > this.rms ? frameRms : this.rms * 0.85 + frameRms * 0.15;

    const resampled = this.resample(channel);
    for (let i = 0; i < resampled.length; i++) {
      this.buffer[this.filled++] = this.muted ? 0 : resampled[i];
      if (this.filled === FRAME_SAMPLES) {
        const pcm = new Int16Array(FRAME_SAMPLES);
        for (let j = 0; j < FRAME_SAMPLES; j++) {
          const s = Math.max(-1, Math.min(1, this.buffer[j]));
          pcm[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        this.port.postMessage({ pcm: pcm.buffer, rms: this.rms }, [pcm.buffer]);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-recorder', PcmRecorder);
