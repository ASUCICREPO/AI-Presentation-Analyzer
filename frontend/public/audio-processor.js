// Audio processor worklet for capturing and encoding PCM audio
// This runs in the AudioWorklet context (separate thread)

class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 512; // ~32ms at 16kHz
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];

    // Check if we have input
    if (!input || !input[0]) {
      return true;
    }

    const inputChannel = input[0]; // Mono channel

    // Fill buffer
    for (let i = 0; i < inputChannel.length; i++) {
      this.buffer[this.bufferIndex++] = inputChannel[i];

      // When buffer is full, convert to Int16 PCM and send
      if (this.bufferIndex >= this.bufferSize) {
        this.sendAudioData();
        this.bufferIndex = 0;
      }
    }

    return true; // Keep processor alive
  }

  sendAudioData() {
    // Convert Float32 (-1.0 to 1.0) to Int16 PCM (-32768 to 32767)
    const pcmData = new Int16Array(this.bufferSize);

    for (let i = 0; i < this.bufferSize; i++) {
      const sample = Math.max(-1, Math.min(1, this.buffer[i])); // Clamp
      pcmData[i] = sample < 0 ? sample * 32768 : sample * 32767;
    }

    // Send as array buffer to main thread
    this.port.postMessage({
      type: 'audio',
      audioData: pcmData.buffer,
    }, [pcmData.buffer]); // Transfer ownership for efficiency
  }
}

registerProcessor('audio-processor', AudioProcessor);
