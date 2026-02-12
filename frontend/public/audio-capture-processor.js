// AudioWorklet processor that captures raw PCM Float32 samples
// and sends them to the main thread for Transcribe streaming.
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._active = true;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') this._active = false;
    };
  }

  process(inputs) {
    if (!this._active) return false;

    const input = inputs[0];
    if (input && input[0] && input[0].length > 0) {
      // Copy the Float32 channel data and send to main thread
      this.port.postMessage(new Float32Array(input[0]));
    }
    return true;
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
