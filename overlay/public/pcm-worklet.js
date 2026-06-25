class PcmMono extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const frames = input[0].length, ch = input.length
    const mono = new Float32Array(frames)
    for (let i = 0; i < frames; i++) {
      let s = 0
      for (let c = 0; c < ch; c++) s += input[c][i]
      mono[i] = s / ch
    }
    this.port.postMessage(mono)
    return true
  }
}
registerProcessor('pcm-mono', PcmMono)
