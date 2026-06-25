let activeLoops: Record<'system' | 'mic', boolean> = {
  system: false,
  mic: false
}

export function attachMeter(
  ctx: AudioContext,
  srcNode: AudioNode,
  source: 'system' | 'mic'
): { disconnect: () => void } {
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 256
  srcNode.connect(analyser)

  const bufferLength = analyser.frequencyBinCount
  const dataArray = new Float32Array(bufferLength)

  const meterBar = document.getElementById(`${source}-meter-fill`) as HTMLDivElement

  activeLoops[source] = true

  function draw(): void {
    if (!activeLoops[source]) {
      if (meterBar) {
        meterBar.style.width = '0%'
      }
      return
    }

    analyser.getFloatTimeDomainData(dataArray)

    // Calculate Root Mean Square (RMS)
    let sum = 0
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i] * dataArray[i]
    }
    const rms = Math.sqrt(sum / dataArray.length)

    // Convert RMS to a percentage for the meter bar
    // Standard speaking voice RMS is typically 0.01 to 0.1. Let's apply a multiplier
    // or log scale. A simple linear scale with a boost works well for visual feedback.
    const level = Math.min(100, Math.round(rms * 300))

    if (meterBar) {
      meterBar.style.width = `${level}%`
    }

    requestAnimationFrame(draw)
  }

  // Start animation loop
  draw()

  return {
    disconnect: () => {
      activeLoops[source] = false
      try {
        srcNode.disconnect(analyser)
      } catch (e) {
        // Source node might already be disconnected or context closed
      }
    }
  }
}
