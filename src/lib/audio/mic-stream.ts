/** Stream the microphone as 16 kHz mono PCM16 chunks (what voxd's live transcription expects). */

export const LIVE_RATE = 16000

export interface MicStream {
  analyser: AnalyserNode
  stop: () => void
}

function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input
  const ratio = from / to
  const out = new Float32Array(Math.floor(input.length / ratio))
  for (let i = 0; i < out.length; i++) {
    // Average the source samples that fall into this output sample (simple low-pass).
    const start = Math.floor(i * ratio)
    const end = Math.min(input.length, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = start; j < end; j++) sum += input[j]
    out[i] = sum / Math.max(1, end - start)
  }
  return out
}

function toPcm16(samples: Float32Array): ArrayBuffer {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out.buffer
}

export async function startMicStream(onChunk: (pcm16: ArrayBuffer) => void): Promise<MicStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  // Ask for 16 kHz directly; engines that can't honour it fall back to the device rate and we resample.
  let ctx: AudioContext
  try {
    ctx = new AudioContext({ sampleRate: LIVE_RATE })
  } catch {
    ctx = new AudioContext()
  }
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 256
  source.connect(analyser)

  // ScriptProcessor is deprecated but universally supported and needs no separate module
  // (AudioWorklet modules from blob: URLs are blocked by the app's content security policy).
  const processor = ctx.createScriptProcessor(2048, 1, 1)
  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0)
    onChunk(toPcm16(downsample(input, ctx.sampleRate, LIVE_RATE)))
  }
  source.connect(processor)
  processor.connect(ctx.destination) // required for onaudioprocess to fire; outputs silence

  return {
    analyser,
    stop: () => {
      processor.disconnect()
      source.disconnect()
      stream.getTracks().forEach((t) => t.stop())
      void ctx.close()
    },
  }
}

export interface LiveHandlers {
  onPartial: (text: string) => void
  onFinal: (segment: { start: number; end: number; text: string }) => void
  onDone: (result: { text: string; transcript_id: string | null }) => void
  onError: (message: string) => void
}

/** A live transcription session: mic → voxd WebSocket → partial/final text. */
export async function startLiveTranscription(url: string, handlers: LiveHandlers) {
  const ws = new WebSocket(url)
  ws.binaryType = 'arraybuffer'
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Error('Couldn’t connect to the voice engine'))
  })
  let mic: MicStream | null = null
  let finished = false
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data as string)
    if (msg.type === 'partial') handlers.onPartial(msg.text)
    else if (msg.type === 'final') handlers.onFinal(msg.segment)
    else if (msg.type === 'done') {
      finished = true
      handlers.onDone(msg)
    } else if (msg.type === 'error') handlers.onError(msg.message)
  }
  ws.onclose = () => {
    mic?.stop()
    if (!finished) handlers.onError('The connection to the voice engine closed')
  }
  try {
    mic = await startMicStream((chunk) => ws.readyState === WebSocket.OPEN && ws.send(chunk))
  } catch {
    ws.close()
    throw new Error('Microphone access was blocked. Allow it in System Settings → Privacy & Security → Microphone.')
  }
  return {
    analyser: mic.analyser,
    /** Stop listening; the final text arrives via onDone. */
    stop: () => {
      mic?.stop()
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' }))
    },
  }
}
