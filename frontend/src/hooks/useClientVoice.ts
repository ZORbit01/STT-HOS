import { useEffect, useRef, useState, useCallback } from 'react'
import { deviceLogin } from '../api/auth'
import { listCases, requestCancellation, transitionCase } from '../api/cases'
import { listRooms } from '../api/rooms'
import { useAuthStore } from '../store/useAuthStore'
import type { Case, CasePhase } from '../types'
import { DEVICE_PASSWORD, PTT_MAX_MS, PTT_MIN_MS, WS_BACKOFF } from '../pages/client/constants'
import type { OrbState, VoiceState, VadMode, ClientMode, LastCommand } from '../pages/client/types'
import { encodeToBase64, resampleTo16k } from '../pages/client/utils/audio'
import { playAccepted, playRejected, playReview, playListening, playTimeout } from '../pages/client/utils/sounds'

const MIC_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
}

const CLIENT_VAD_MODE_KEY = 'client:vad-mode'
const CLIENT_PTT_HOTKEY_KEY = 'client:ptt-hotkey'
const CLIENT_PTT_HOTKEY_EVENT = 'client:ptt-hotkey-changed'
const DEFAULT_PTT_HOTKEY = 'Space'

function storedVadMode(): VadMode {
  const value = localStorage.getItem(CLIENT_VAD_MODE_KEY)
  return value === 'wake' ? 'wake' : 'ptt'
}

function storedPttHotkey(): string {
  return localStorage.getItem(CLIENT_PTT_HOTKEY_KEY) || DEFAULT_PTT_HOTKEY
}

// ─── Returned interface ─────────────────────────────────────────────────────

export interface UseClientVoiceReturn {
  // Auth
  deviceReady: boolean
  deviceError: string
  nurseToken: string | null
  setNurseToken: (token: string | null) => void
  nurseName: string
  setNurseName: (name: string) => void

  // Voice / UI state
  orbState: OrbState
  amplitude: number
  mode: ClientMode
  setMode: (mode: ClientMode) => void
  vadMode: VadMode
  setVadMode: (vadMode: VadMode) => void
  pttHotkey: string
  setPttHotkey: (hotkey: string) => void
  lastCmd: LastCommand | null

  // Case
  activeCase: Case | undefined
  roomCases: Case[]
  allCases: Case[]
  nextCase: Case | undefined

  // Connection
  wsReady: boolean

  // Actions
  startPTT: () => void
  endPTT: () => void
  handleButtonTransition: (phase: CasePhase, caseCode?: string) => Promise<void>
  handleStartCase: (caseCode: string) => Promise<void>
  handleRequestCancellation: () => Promise<void>
  refreshCase: () => Promise<void>
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useClientVoice(room: string): UseClientVoiceReturn {
  const { token, name } = useAuthStore()
  // ── State
  const [deviceReady, setDeviceReady] = useState(false)
  const [deviceError, setDeviceError] = useState('')
  const [nurseToken, setNurseToken] = useState<string | null>(token)
  const [nurseName, setNurseName] = useState(name ?? '')
  const [orbState, setOrbState] = useState<OrbState>('idle')
  const [amplitude, setAmplitude] = useState(0)
  const [mode, setMode] = useState<ClientMode>('voice')
  const [vadMode, setVadMode] = useState<VadMode>(storedVadMode)
  const [pttHotkey, setPttHotkey] = useState(storedPttHotkey)
  const [lastCmd, setLastCmd] = useState<LastCommand | null>(null)
  const [activeCase, setActiveCase] = useState<Case | undefined>()
  const [roomCases, setRoomCases] = useState<Case[]>([])
  const [allCases, setAllCases] = useState<Case[]>([])
  const [wsReady, setWsReady] = useState(false)
  const [scanEpoch, setScanEpoch] = useState(0)

  // ── Core refs
  const deviceTokenRef = useRef<string | null>(null)
  const wsRef          = useRef<WebSocket | null>(null)
  const orbTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pttTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryRef       = useRef(0)
  const deadRef        = useRef(false)

  // ── Voice state machine ref
  const voiceStateRef = useRef<VoiceState>('IDLE')

  // ── PTT-mode mic refs
  const pttAcRef        = useRef<AudioContext | null>(null)
  const pttStreamRef    = useRef<MediaStream | null>(null)
  const pttProcRef      = useRef<ScriptProcessorNode | null>(null)
  const pttBufRef       = useRef<Float32Array[]>([])
  const pttSrRef        = useRef<number>(44100)
  const pttReleasedRef  = useRef(false)  // key released before mic finished starting
  const pttStartMsRef   = useRef(0)      // when CMD_RECORDING began

  // ── Wake-mode mic refs
  const wakeAcRef     = useRef<AudioContext | null>(null)
  const wakeStreamRef = useRef<MediaStream | null>(null)
  const wakeProcRef   = useRef<ScriptProcessorNode | null>(null)
  const micLevelRef   = useRef(0)
  const amplitudePaintAtRef = useRef(0)

  // ── Shared AudioContext for sound effects
  const soundAcRef = useRef<AudioContext | null>(null)

  // ── Refs that mirror state for callbacks
  const vadModeRef = useRef<VadMode>('ptt')
  const pttHotkeyRef = useRef(storedPttHotkey())
  const wsReadyRef = useRef(false)
  const modeRef    = useRef<ClientMode>('voice')
  useEffect(() => { vadModeRef.current = vadMode }, [vadMode])
  useEffect(() => { pttHotkeyRef.current = pttHotkey }, [pttHotkey])
  useEffect(() => { wsReadyRef.current = wsReady }, [wsReady])
  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => { setNurseToken(token); setNurseName(name ?? '') }, [token, name])
  useEffect(() => { localStorage.setItem('client:voice-mode', 'voice') }, [])
  useEffect(() => { localStorage.setItem(CLIENT_VAD_MODE_KEY, vadMode) }, [vadMode])
  useEffect(() => {
    function syncHotkey() {
      setPttHotkey(storedPttHotkey())
    }

    window.addEventListener('storage', syncHotkey)
    window.addEventListener(CLIENT_PTT_HOTKEY_EVENT, syncHotkey)
    return () => {
      window.removeEventListener('storage', syncHotkey)
      window.removeEventListener(CLIENT_PTT_HOTKEY_EVENT, syncHotkey)
    }
  }, [])

  // ── Sound helper — lazy-init shared AudioContext
  function sound() {
    if (!soundAcRef.current) soundAcRef.current = new AudioContext()
    const ac = soundAcRef.current
    if (ac.state === 'suspended') ac.resume()
    return ac
  }

  // ── Device login
  useEffect(() => {
    deviceLogin(`${room.toLowerCase()}_device`, DEVICE_PASSWORD)
      .then((res) => { deviceTokenRef.current = res.data.access_token; setDeviceReady(true) })
      .catch(() => setDeviceError('Device not recognised. Contact admin.'))
  }, [room])

  // ── Fetch active case
  const refreshCase = useCallback(async () => {
    if (!nurseToken) return
    try {
      const [roomsRes, casesRes] = await Promise.all([listRooms(), listCases()])
      const activeCaseCode = roomsRes.data.find((r) => r.room_code === room)?.active_case_code
      const activeByRoom = activeCaseCode
        ? casesRes.data.find((c: Case) => c.case_code === activeCaseCode)
        : undefined
      const activeBySchedule = casesRes.data.find(
        (c: Case) =>
          c.scheduled_room_code === room &&
          c.current_phase !== 'IDLE' &&
          c.current_phase !== 'COMPLETE' &&
          c.current_phase !== 'CANCELLED',
      )
      const casesForRoom = casesRes.data
        .filter((c: Case) => c.scheduled_room_code === room)
        .sort((a: Case, b: Case) => new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime())
      setActiveCase(activeByRoom ?? activeBySchedule)
      setRoomCases(casesForRoom)
      setAllCases(
        [...casesRes.data].sort(
          (a: Case, b: Case) => new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime(),
        ),
      )
    } catch { /* silent */ }
  }, [nurseToken, room])

  useEffect(() => { refreshCase() }, [refreshCase])

  // ── Send audio to backend as a single packet
  async function sendAudio(chunks: Float32Array[], nativeSr: number) {
    if (chunks.length === 0 || wsRef.current?.readyState !== WebSocket.OPEN) {
      voiceStateRef.current = 'IDLE'
      setOrbState('idle')
      return
    }

    voiceStateRef.current = 'PROCESSING'
    setOrbState('processing')
    setAmplitude(0)
    orbTimerRef.current = setTimeout(() => {
      if (voiceStateRef.current === 'PROCESSING') {
        voiceStateRef.current = 'IDLE'
        setOrbState(vadModeRef.current === 'wake' ? 'wake_ready' : 'idle')
      }
    }, 5000)

    // Paint the released/processing state before doing mobile audio conversion.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    try {
      const total = chunks.reduce((n, c) => n + c.length, 0)
      const merged = new Float32Array(total)
      let off = 0
      for (const c of chunks) { merged.set(c, off); off += c.length }
      console.log(`[Audio] ${(total / nativeSr).toFixed(2)}s @ ${nativeSr}Hz → resampling to 16kHz`)
      const resampled = await resampleTo16k(merged, nativeSr)
      if (wsRef.current?.readyState !== WebSocket.OPEN) throw new Error('Voice connection closed')
      const audioB64 = encodeToBase64(resampled.buffer as ArrayBuffer)
      wsRef.current.send(JSON.stringify({ type: 'command_start' }))
      wsRef.current.send(JSON.stringify({ type: 'audio_packet', audio_b64: audioB64, sample_rate: 16000 }))
    } catch {
      if (orbTimerRef.current) { clearTimeout(orbTimerRef.current); orbTimerRef.current = null }
      voiceStateRef.current = 'IDLE'
      setOrbState('idle')
    }
  }

  // ── PTT mode mic controls
  function updateMicAmplitude(data: Float32Array, gain: number) {
    let sum = 0
    for (let i = 0; i < data.length; i++) sum += Math.abs(data[i])
    const raw = Math.min(1, (sum / data.length) * gain)
    micLevelRef.current = micLevelRef.current * 0.72 + raw * 0.28
    const now = performance.now()
    if (now - amplitudePaintAtRef.current >= 80) {
      amplitudePaintAtRef.current = now
      setAmplitude(micLevelRef.current)
    }
  }

  async function startPTTMic() {
    const ac = new AudioContext()
    pttAcRef.current = ac
    pttSrRef.current = ac.sampleRate
    pttBufRef.current = []
    const stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_AUDIO_CONSTRAINTS, video: false })
    pttStreamRef.current = stream
    const source = ac.createMediaStreamSource(stream)
    const proc = ac.createScriptProcessor(4096, 1, 1)
    pttProcRef.current = proc
    proc.onaudioprocess = (ev) => {
      if (voiceStateRef.current !== 'CMD_RECORDING') return
      const data = ev.inputBuffer.getChannelData(0)
      updateMicAmplitude(data, 20)
      pttBufRef.current.push(new Float32Array(data))
    }
    source.connect(proc)
    proc.connect(ac.destination)
  }

  function stopPTTMic() {
    pttProcRef.current?.disconnect()
    pttStreamRef.current?.getTracks().forEach(t => t.stop())
    pttAcRef.current?.close()
    pttProcRef.current = null
    pttStreamRef.current = null
    pttAcRef.current = null
    micLevelRef.current = 0
    setAmplitude(0)
  }

  const endPTT = useCallback(() => {
    if (voiceStateRef.current !== 'CMD_RECORDING') {
      // Key released while mic was still starting — flag it so startPTT aborts after getUserMedia
      pttReleasedRef.current = true
      return
    }
    if (pttTimerRef.current) { clearTimeout(pttTimerRef.current); pttTimerRef.current = null }
    const chunks = pttBufRef.current
    pttBufRef.current = []
    const sr = pttSrRef.current
    stopPTTMic()
    // Discard taps shorter than PTT_MIN_MS — not enough audio to transcribe
    if (Date.now() - pttStartMsRef.current < PTT_MIN_MS) {
      voiceStateRef.current = 'IDLE'
      setOrbState('idle')
      return
    }
    sendAudio(chunks, sr)
  }, [])

  const startPTT = useCallback(async () => {
    if (voiceStateRef.current !== 'IDLE') return
    if (modeRef.current !== 'voice' || !wsReadyRef.current) return
    if (orbTimerRef.current) { clearTimeout(orbTimerRef.current); orbTimerRef.current = null }
    pttReleasedRef.current = false
    pttStartMsRef.current = Date.now()
    voiceStateRef.current = 'CMD_RECORDING'
    playListening(sound())
    setOrbState('listening')
    try { await startPTTMic() } catch {
      voiceStateRef.current = 'IDLE'; setOrbState('idle'); return
    }
    // Key was released while mic was starting up — discard and reset
    if (pttReleasedRef.current) {
      pttBufRef.current = []
      stopPTTMic()
      voiceStateRef.current = 'IDLE'
      setOrbState('idle')
      return
    }
    pttTimerRef.current = setTimeout(() => {
      if (voiceStateRef.current === 'CMD_RECORDING') endPTT()
    }, PTT_MAX_MS)
  }, [endPTT])

  // ── Handle command_response from backend
  const handleCommandResponse = useCallback((msg: any) => {
    const p = msg.payload ?? {}
    const outcome = p.outcome ?? ''
    const case_code = p.case_code ?? ''
    const to_phase = p.to_phase ?? ''
    const confidence = p.confidence ?? 0
    const raw_transcript = p.raw_transcript ?? `${case_code} ${to_phase}`
    const ac = sound()

    if (orbTimerRef.current) { clearTimeout(orbTimerRef.current); orbTimerRef.current = null }

    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setLastCmd({ text: raw_transcript, time: timeStr, confidence })

    if (outcome === 'accepted') {
      setOrbState('accepted'); playAccepted(ac); refreshCase()
    } else if (outcome === 'review_needed') {
      setOrbState('review'); playReview(ac)
    } else if (outcome === 'no_match') {
      setOrbState('rejected'); playRejected(ac)
      setLastCmd({ text: `"${raw_transcript}" — not recognised`, time: timeStr, confidence: 0 })
    } else {
      setOrbState('rejected'); playRejected(ac)
    }

    // Re-arm wake mode IMMEDIATELY — swap back to scan processor on the existing mic.
    // No getUserMedia delay — the AudioContext and MediaStream stay alive.
    voiceStateRef.current = 'IDLE'
    if (vadModeRef.current === 'wake') {
      if (wsRef.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ type: 'set_wake_mode', enabled: true }))
      restartScanOnExistingMic()
    }

    // Brief UI flash (accepted/rejected → wake_ready) — short delay just for visual feedback
    orbTimerRef.current = setTimeout(() => {
      setOrbState(vadModeRef.current === 'wake' ? 'wake_ready' : 'idle')
    }, 450)
  }, [refreshCase])

  // ── Restart scan processor on the existing mic graph (no getUserMedia delay)
  function restartScanOnExistingMic() {
    const ac = wakeAcRef.current
    const stream = wakeStreamRef.current
    if (!ac || !stream) {
      // No mic to reuse — fall back to full rebuild
      setScanEpoch(e => e + 1)
      return
    }

    // Disconnect any existing scan processor before rebuilding the graph.
    wakeProcRef.current?.disconnect()

    const nativeSr = ac.sampleRate
    const source = ac.createMediaStreamSource(stream)
    const proc = ac.createScriptProcessor(4096, 1, 1)
    wakeProcRef.current = proc
    source.connect(proc); proc.connect(ac.destination)

    let scanBuf: Float32Array[] = []
    let lastSend = 0
    const WAKE_CHUNK_MS = 200

    proc.onaudioprocess = (ev) => {
      if (voiceStateRef.current !== 'IDLE' && voiceStateRef.current !== 'WAKE_LISTENING') return
      const input = ev.inputBuffer.getChannelData(0)
      updateMicAmplitude(input, voiceStateRef.current === 'WAKE_LISTENING' ? 22 : 14)
      scanBuf.push(new Float32Array(input))
      const now = Date.now()
      if (now - lastSend < WAKE_CHUNK_MS) return
      lastSend = now
      const total = scanBuf.reduce((n, c) => n + c.length, 0)
      const merged = new Float32Array(total)
      let off = 0; for (const c of scanBuf) { merged.set(c, off); off += c.length }
      scanBuf = []
      if (wsRef.current?.readyState !== WebSocket.OPEN) return
      resampleTo16k(merged, nativeSr).then(resampled => {
        if (voiceStateRef.current !== 'IDLE' && voiceStateRef.current !== 'WAKE_LISTENING') return
        if (wsRef.current?.readyState !== WebSocket.OPEN) return
        wsRef.current.send(JSON.stringify({
          type: 'audio_packet',
          audio_b64: encodeToBase64(resampled.buffer as ArrayBuffer),
          sample_rate: 16000,
        }))
      })
    }

    setOrbState('wake_ready')
  }

  // ── WebSocket
  const connectWS = useCallback(() => {
    if (deadRef.current || !deviceTokenRef.current || !nurseToken) return
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/audio/${room}`)
    wsRef.current = ws

    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: deviceTokenRef.current }))

    ws.onmessage = (e) => {
      let msg: any
      try { msg = JSON.parse(e.data) } catch { return }

      if (msg.type === 'auth_ok' || msg.event === 'auth_ok') {
        retryRef.current = 0; setWsReady(true); refreshCase(); return
      }

      if (msg.event === 'wake_activated' || msg.type === 'wake_activated') {
        if (voiceStateRef.current !== 'IDLE') return
        if (modeRef.current !== 'voice') return

        voiceStateRef.current = 'WAKE_LISTENING'
        playListening(sound())
        setOrbState('listening')

        // UI safety timeout only. Backend owns command capture and endpointing.
        pttTimerRef.current = setTimeout(() => {
          if (voiceStateRef.current === 'WAKE_LISTENING') {
            playTimeout(sound())
            voiceStateRef.current = 'IDLE'; setOrbState('wake_ready'); setAmplitude(0)
            if (wsRef.current?.readyState === WebSocket.OPEN)
              wsRef.current.send(JSON.stringify({ type: 'set_wake_mode', enabled: true }))
          }
        }, 9000)
        return
      }

      if (msg.event === 'command_response') {
        handleCommandResponse(msg)
      }

      if (msg.event === 'phase_transition' || msg.event === 'schedule_changed') {
        refreshCase()
      }
    }

    ws.onclose = () => {
      setWsReady(false)
      // Reset any in-flight voice state so the nurse sees the connection is dead
      voiceStateRef.current = 'IDLE'
      setOrbState('idle')
      setAmplitude(0)
      if (orbTimerRef.current) { clearTimeout(orbTimerRef.current); orbTimerRef.current = null }
      if (pttTimerRef.current) { clearTimeout(pttTimerRef.current); pttTimerRef.current = null }
      if (deadRef.current) return
      const delay = WS_BACKOFF[Math.min(retryRef.current++, WS_BACKOFF.length - 1)]
      setTimeout(connectWS, delay)
    }
    ws.onerror = () => ws.close()
  }, [nurseToken, room, refreshCase, handleCommandResponse])

  useEffect(() => {
    if (!nurseToken || !deviceReady) return
    deadRef.current = false
    connectWS()
    return () => { deadRef.current = true; wsRef.current?.close() }
  }, [nurseToken, deviceReady, connectWS])

  // ── Wake mode — set mode on backend
  useEffect(() => {
    if (!wsReady || wsRef.current?.readyState !== WebSocket.OPEN) return
    wsRef.current.send(JSON.stringify({ type: 'set_wake_mode', enabled: vadMode === 'wake' }))
  }, [vadMode, wsReady])

  // ── Wake mode — scan stream
  useEffect(() => {
    if (vadMode !== 'wake' || !nurseToken || !wsReady) return
    let alive = true
    const WAKE_CHUNK_MS = 200

    async function startScan() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_AUDIO_CONSTRAINTS, video: false })
        if (!alive) { stream.getTracks().forEach(t => t.stop()); return }
        const ac = new AudioContext()
        wakeAcRef.current = ac
        wakeStreamRef.current = stream
        const nativeSr = ac.sampleRate
        const source = ac.createMediaStreamSource(stream)
        const proc = ac.createScriptProcessor(4096, 1, 1)
        wakeProcRef.current = proc
        source.connect(proc); proc.connect(ac.destination)

        let scanBuf: Float32Array[] = []
        let lastSend = 0

        proc.onaudioprocess = (ev) => {
          if (!alive || (voiceStateRef.current !== 'IDLE' && voiceStateRef.current !== 'WAKE_LISTENING')) return
          const input = ev.inputBuffer.getChannelData(0)
          updateMicAmplitude(input, voiceStateRef.current === 'WAKE_LISTENING' ? 22 : 14)
          scanBuf.push(new Float32Array(input))
          const now = Date.now()
          if (now - lastSend < WAKE_CHUNK_MS) return
          lastSend = now
          const total = scanBuf.reduce((n, c) => n + c.length, 0)
          const merged = new Float32Array(total)
          let off = 0; for (const c of scanBuf) { merged.set(c, off); off += c.length }
          scanBuf = []
          if (wsRef.current?.readyState !== WebSocket.OPEN) return
          resampleTo16k(merged, nativeSr).then(resampled => {
            if (!alive || (voiceStateRef.current !== 'IDLE' && voiceStateRef.current !== 'WAKE_LISTENING')) return
             if (wsRef.current?.readyState !== WebSocket.OPEN) return
            wsRef.current.send(JSON.stringify({
              type: 'audio_packet',
              audio_b64: encodeToBase64(resampled.buffer as ArrayBuffer),
              sample_rate: 16000,
            }))
          })
        }

        setOrbState('wake_ready')
      } catch (e) { console.error('[Wake scan] mic failed:', e) }
    }

    startScan()

    return () => {
      alive = false
      wakeProcRef.current?.disconnect()
      wakeStreamRef.current?.getTracks().forEach(t => t.stop())
      wakeAcRef.current?.close()
      wakeProcRef.current = null; wakeStreamRef.current = null; wakeAcRef.current = null
      voiceStateRef.current = 'IDLE'
      micLevelRef.current = 0
      setOrbState('idle'); setAmplitude(0)
    }
  }, [vadMode, nurseToken, wsReady, scanEpoch])

  // ── PTT listeners — hold-to-speak for any key (keyboard, foot pedal, headset button)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== pttHotkeyRef.current || e.repeat) return
      e.preventDefault()
      if (vadModeRef.current === 'ptt') startPTT()
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== pttHotkeyRef.current) return
      if (vadModeRef.current === 'ptt') endPTT()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [startPTT, endPTT, pttHotkey])

  // ── Button mode transition — carries this room so the backend applies the
  //    same mic-room-wins override as the STT path. An explicitly selected case
  //    (tapped in the room schedule) wins over the default queue order, but
  //    never over a case that is already running.
  async function handleButtonTransition(phase: CasePhase, caseCode?: string) {
    if (!nurseToken) return
    const selected = caseCode
      ? roomCases.find((c) => c.case_code === caseCode) ?? allCases.find((c) => c.case_code === caseCode)
      : undefined
    const target = activeCase ?? selected ?? nextCase
    if (!target) { playRejected(sound()); return }
    try {
      await transitionCase(target.case_code, phase, room)
      // Mirror the voice path: a confirmed button transition gets the same accepted chime.
      playAccepted(sound())
      await refreshCase()
    } catch {
      playRejected(sound())
    }
  }

  // ── Start ANY startable case in this room (cross-room or out of order),
  //    triggering the same reassignment events as a voice command would
  async function handleStartCase(caseCode: string) {
    if (!nurseToken) return
    try {
      await transitionCase(caseCode, 'IN', room)
      playAccepted(sound())
      await refreshCase()
    } catch {
      playRejected(sound())
    }
  }

  // ── Request cancellation
  async function handleRequestCancellation() {
    if (!nurseToken) return
    const target = activeCase ?? nextCase
    if (!target) return
    try { await requestCancellation(target.case_code); await refreshCase() } catch { }
  }

  const nextCase = roomCases.find(
    (c) => c.id !== activeCase?.id && c.current_phase !== 'COMPLETE' && c.current_phase !== 'CANCELLED',
  )

  return {
    deviceReady, deviceError,
    nurseToken, setNurseToken,
    nurseName, setNurseName,
    orbState, amplitude,
    mode, setMode,
    vadMode, setVadMode,
    pttHotkey, setPttHotkey,
    lastCmd,
    activeCase,
    roomCases,
    allCases,
    nextCase,
    wsReady,
    startPTT,
    endPTT,
    handleButtonTransition,
    handleStartCase,
    handleRequestCancellation,
    refreshCase,
  }
}
