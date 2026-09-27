import { useEffect, useRef, useState } from 'react'

export type RecorderState = 'idle' | 'requesting' | 'recording' | 'denied'

/** Microphone recording with a live input level (0–1) and elapsed time. */
export function useRecorder(maxSeconds = 60) {
  const [state, setState] = useState<RecorderState>('idle')
  const [level, setLevel] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const stream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const resolve = useRef<((blob: Blob) => void) | null>(null)
  const raf = useRef(0)

  const cleanup = () => {
    cancelAnimationFrame(raf.current)
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    setLevel(0)
  }

  useEffect(() => cleanup, [])

  const start = async () => {
    setState('requesting')
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      })
    } catch {
      setState('denied')
      return
    }
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    ctx.createMediaStreamSource(stream.current).connect(analyser)
    const buf = new Float32Array(analyser.fftSize)
    const began = performance.now()
    const tick = () => {
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (const s of buf) sum += s * s
      // Map RMS in dB (-60…0) to 0…1 for the meter.
      setLevel(Math.max(0, Math.min(1, (20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-9) + 60) / 60)))
      const secs = (performance.now() - began) / 1000
      setElapsed(secs)
      if (secs >= maxSeconds) recorder.current?.stop()
      raf.current = requestAnimationFrame(tick)
    }
    tick()

    chunks.current = []
    const rec = new MediaRecorder(stream.current)
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
    rec.onstop = () => {
      void ctx.close()
      cleanup()
      setState('idle')
      resolve.current?.(new Blob(chunks.current, { type: rec.mimeType }))
    }
    recorder.current = rec
    rec.start(250)
    setElapsed(0)
    setState('recording')
  }

  /** Stop and get the recording. */
  const stop = () =>
    new Promise<Blob>((res) => {
      resolve.current = res
      recorder.current?.stop()
    })

  return { state, level, elapsed, start, stop }
}
