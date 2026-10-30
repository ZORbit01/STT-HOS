import { useEffect, useState } from 'react'
import { useParams, Navigate, useNavigate } from 'react-router-dom'
import { ListBulletIcon, MicrophoneIcon } from '@heroicons/react/24/outline'
import { claimClientRoom, releaseClientRoom } from '../../api/clientSessions'
import { listInductionPhysicians } from '../../api/inductionPhysicians'
import { useAuthStore } from '../../store/useAuthStore'
import type { Case, InductionPhysician } from '../../types'
import { VALID_ROOMS } from './constants'
import type { OrbState } from './types'
import { StatusBar } from './components/StatusBar'
import { CommandBar } from './components/CommandBar'
import { ModeToggles } from './components/ModeToggles'
import { CaseProgressPanel } from './components/CaseProgressPanel'
import { StartCaseSheet } from './components/StartCaseSheet'
import { InductionPhysicianPicker } from './components/InductionPhysicianPicker'
import { DelayReasonModal } from './components/DelayReasonModal'
import { Orb } from './components/Orb'
import { notifyShiftRoomChanged, SHIFT_ROOM_KEY } from './shiftRoom'
import { useClientVoiceSession } from './clientVoiceSession'

const ORB_LABEL: Record<OrbState, string> = {
  idle: 'Hold pedal to speak',
  wake_ready: 'Say "Hey Sina" to speak',
  listening: 'Listening...',
  processing: 'Processing...',
  accepted: 'Accepted',
  rejected: 'Not recognised',
  review: 'Review needed',
}

const ORB_LABEL_COLOR: Record<OrbState, string> = {
  idle: '#4B5563',
  wake_ready: '#0891B2',
  listening: '#06B6D4',
  processing: '#06B6D4',
  accepted: '#16A34A',
  rejected: '#DC2626',
  review: '#D97706',
}

function useNurseWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    let active = true

    async function acquire() {
      if (!active || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return
      try {
        lock = await navigator.wakeLock.request('screen')
      } catch {
        // Unsupported, denied, or low-power mode: the nurse UI continues normally.
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') acquire()
    }

    acquire()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', onVisibilityChange)
      lock?.release().catch(() => undefined)
    }
  }, [])
}

function LargeVoicePanel({
  orbState,
  amplitude,
  wsReady,
  vadMode,
  pttHotkey,
  onPushToTalkStart,
  onPushToTalkEnd,
  onVadModeChange,
}: {
  orbState: OrbState
  amplitude: number
  wsReady: boolean
  vadMode: 'ptt' | 'wake'
  pttHotkey: string
  onPushToTalkStart: () => void
  onPushToTalkEnd: () => void
  onVadModeChange: (mode: 'ptt' | 'wake') => void
}) {
  const label = orbState === 'idle' ? (wsReady ? ORB_LABEL.idle : 'Reconnecting...') : ORB_LABEL[orbState]

  return (
    <section className="relative flex h-full min-h-0 flex-col justify-center border-l border-[#D7DEE8] bg-white px-8 py-6">
      <div className="flex flex-col items-center">
        {vadMode === 'ptt' ? (
          <button
            type="button"
            aria-label="Press and hold to speak"
            onPointerDown={(event) => {
              event.preventDefault()
              event.currentTarget.setPointerCapture(event.pointerId)
              onPushToTalkStart()
            }}
            onPointerUp={(event) => {
              event.preventDefault()
              onPushToTalkEnd()
            }}
            onPointerCancel={onPushToTalkEnd}
            onLostPointerCapture={onPushToTalkEnd}
            onContextMenu={(event) => event.preventDefault()}
            className="touch-none rounded-full outline-none focus-visible:ring-4 focus-visible:ring-cyan-200 active:scale-95"
          >
            <Orb state={orbState} amplitude={amplitude} />
          </button>
        ) : (
          <Orb state={orbState} amplitude={amplitude} />
        )}
        <p className="mt-2 text-center text-base font-black" style={{ color: ORB_LABEL_COLOR[orbState] }}>
          {label}
        </p>
        <p className="mt-1 text-center text-[11px] font-black uppercase tracking-widest text-[#94A3B8]">
          {vadMode === 'wake'
            ? 'Sina mode is listening for wake words'
            : 'Press and hold the microphone, or use the configured pedal'}
        </p>
      </div>

      <div className="mt-6 w-full max-w-md">
        <ModeToggles vadMode={vadMode} pttHotkey={pttHotkey} onVadModeChange={onVadModeChange} />
      </div>
    </section>
  )
}

function TouchVoiceDock({
  orbState,
  wsReady,
  onOpenCases,
  onPushToTalkStart,
  onPushToTalkEnd,
}: {
  orbState: OrbState
  wsReady: boolean
  onOpenCases: () => void
  onPushToTalkStart: () => void
  onPushToTalkEnd: () => void
}) {
  const listening = orbState === 'listening'
  const processing = orbState === 'processing'

  return (
    <div className="touch-voice-dock fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-[1500] h-20 items-center justify-between rounded-2xl border border-[#D7E2EF] bg-white/95 px-5 shadow-[0_18px_50px_rgba(15,32,68,0.24)] backdrop-blur-xl">
      <button type="button" onClick={onOpenCases} className="flex h-14 w-16 flex-col items-center justify-center gap-1 rounded-xl text-[#64748B] active:bg-[#F1F5F9]">
        <ListBulletIcon className="h-5 w-5" />
        <span className="text-[9px] font-black uppercase tracking-wide">Cases</span>
      </button>

      <button
        type="button"
        aria-label="Press and hold to speak"
        disabled={processing || !wsReady}
        onPointerDown={(event) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          onPushToTalkStart()
        }}
        onPointerUp={(event) => {
          event.preventDefault()
          onPushToTalkEnd()
        }}
        onPointerCancel={onPushToTalkEnd}
        onLostPointerCapture={onPushToTalkEnd}
        onContextMenu={(event) => event.preventDefault()}
        className={`absolute left-1/2 top-1/2 flex h-[4.5rem] w-[4.5rem] -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full text-white shadow-[0_12px_28px_rgba(15,32,68,0.3)] outline-none transition disabled:opacity-60 ${
          listening ? 'scale-105 bg-[#0891B2] ring-8 ring-cyan-100' : 'bg-[#0F2044] active:scale-95'
        }`}
      >
        <MicrophoneIcon className="h-8 w-8" />
      </button>

      <div className="flex w-16 flex-col items-center gap-1 text-center">
        <span className={`h-2 w-2 rounded-full ${wsReady ? 'bg-[#16A34A]' : 'bg-[#D97706]'}`} />
        <span className="text-[9px] font-black uppercase tracking-wide text-[#64748B]">
          {processing ? 'Sending' : listening ? 'Release' : wsReady ? 'Hold' : 'Offline'}
        </span>
      </div>
    </div>
  )
}

function formatCaseTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function patientLabel(c: Case) {
  if (c.patient) {
    const initials = `${c.patient.first_name?.[0] ?? ''}.${c.patient.last_name?.[0] ?? ''}.`.replace('..', '.')
    const age = c.patient.age ? ` ${c.patient.age}` : ''
    const sex = c.patient.sex ? c.patient.sex[0]?.toUpperCase() : ''
    return `${initials}${age}${sex}`.trim()
  }
  if (c.patient_name || c.patient_age || c.patient_sex) {
    const initials = (c.patient_name ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('.')
    const age = c.patient_age ? ` ${c.patient_age}` : ''
    const sex = c.patient_sex ? c.patient_sex[0]?.toUpperCase() : ''
    return `${initials ? `${initials}.` : 'Patient'}${age}${sex}`.trim()
  }
  return 'Patient'
}

function displayCaseCode(c: Case) {
  return c.voice_case_code ?? c.case_code
}

function RoomCaseQueue({
  cases,
  activeCase,
  nextCase,
  selectedCaseCode,
  onSelect,
}: {
  cases: Case[]
  activeCase: Case | undefined
  nextCase: Case | undefined
  selectedCaseCode: string | null
  onSelect: (caseCode: string | null) => void
}) {
  const visibleCases = cases.filter((c) => c.current_phase !== 'COMPLETE' && c.current_phase !== 'CANCELLED')
  if (visibleCases.length === 0) return null

  // A queued case can be selected as the stepper target only while the room is free
  const selectable = !activeCase

  return (
    <section className="mt-7">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-widest text-[#0F172A]">Room schedule</div>
          <div className="mt-0.5 text-xs font-semibold text-[#64748B]">
            {selectable ? 'Tap a case to make it the one you start' : `${visibleCases.length} active or upcoming cases`}
          </div>
        </div>
        {nextCase && (
          <div className="text-xs font-black uppercase tracking-widest text-[#0F2044]">
            Next {displayCaseCode(nextCase)}
          </div>
        )}
      </div>

      <div className="mt-3 divide-y divide-[#E2E8F0] border-y border-[#E2E8F0]">
        {visibleCases.map((c) => {
          const active = c.id === activeCase?.id
          const selected = selectable && c.case_code === selectedCaseCode
          const next = c.id === nextCase?.id
          const rowSelectable = selectable && c.current_phase === 'IDLE' && !c.cancellation_requested
          return (
            <button
              key={c.id}
              type="button"
              disabled={!rowSelectable}
              onClick={() => onSelect(selected ? null : c.case_code)}
              className={`grid w-full touch-manipulation grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-4 py-3 text-left ${
                selected ? 'bg-[#EEF6FF]' : ''
              } ${rowSelectable ? 'cursor-pointer active:opacity-70' : 'cursor-default'}`}
            >
              <div className="flex items-center gap-2">
                <span className={`h-8 w-1 rounded-full ${active || selected ? 'bg-[#0F2044]' : next ? 'bg-[#0077B6]' : 'bg-[#CBD5E1]'}`} />
                <span className="text-base font-black text-[#0F172A]">{displayCaseCode(c)}</span>
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-[#334155]">{c.procedure_name}</div>
                <div className="truncate text-xs font-semibold text-[#64748B]">
                  {patientLabel(c)} · Dr. {c.doctor.last_name}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs font-black text-[#475569]">{formatCaseTime(c.scheduled_start)}</div>
                <div className={`text-[10px] font-black uppercase tracking-wide ${selected ? 'text-[#0F2044]' : 'text-[#94A3B8]'}`}>
                  {active ? 'Current' : selected ? 'Selected' : next ? 'Next' : `${c.estimated_duration_min}m`}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function ClientConsole({
  room,
  inductionPhysicianName,
  onChangeInductionPhysician,
  onEndShift,
}: {
  room: string
  inductionPhysicianName: string
  onChangeInductionPhysician: () => void
  onEndShift: () => void
}) {
  useNurseWakeLock()
  const voice = useClientVoiceSession()
  const [startSheetOpen, setStartSheetOpen] = useState(false)
  const [selectedCaseCode, setSelectedCaseCode] = useState<string | null>(null)

  if (!voice) {
    return (
      <div className="flex min-h-[calc(100dvh-var(--app-nav-height))] items-center justify-center bg-white">
        <div className="text-sm font-semibold text-[#64748B]">Opening {room}...</div>
      </div>
    )
  }

  const {
    deviceReady, deviceError,
    nurseToken,
    nurseName,
    vadMode, setVadMode,
    pttHotkey,
    orbState,
    amplitude,
    lastCmd,
    activeCase,
    roomCases,
    allCases,
    nextCase,
    wsReady,
    handleButtonTransition,
    handleStartCase,
    handleRequestCancellation,
    refreshCase,
    startPTT,
    endPTT,
  } = voice

  // A schedule row the nurse tapped becomes the stepper's start target.
  // Only honoured while the room has no running case and the case is startable.
  const selectedRoomCase = !activeCase && selectedCaseCode
    ? roomCases.find((c) => c.case_code === selectedCaseCode && c.current_phase === 'IDLE' && !c.cancellation_requested)
    : undefined

  // ── Guard: device error
  if (deviceError) return (
    <div className="flex min-h-[calc(100dvh-var(--app-nav-height))] items-center justify-center bg-white">
      <p className="text-sm font-semibold" style={{ color: '#DC2626' }}>{deviceError}</p>
    </div>
  )

  // ── Guard: device loading
  if (!deviceReady) return (
    <div className="flex min-h-[calc(100dvh-var(--app-nav-height))] items-center justify-center bg-white">
      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#374151', animation: 'orb-breathe 2s ease-in-out infinite' }} />
    </div>
  )

  if (!nurseToken) return <Navigate to="/login" replace />

  // ── Main UI
  return (
    <>
      <style>{`
        @keyframes orb-breathe { 0%,100%{transform:scale(1);opacity:0.7} 50%{transform:scale(1.06);opacity:1} }
        @keyframes orb-ripple  { 0%{transform:scale(0.85);opacity:0.3} 100%{transform:scale(1.6);opacity:0} }
        @keyframes orb-spin    { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      `}</style>

      <div className="relative flex h-[calc(100dvh-var(--app-nav-height))] w-full min-w-0 max-w-full flex-col select-none overflow-hidden bg-[#F3F7FB]">
        <StatusBar
          room={room}
          activeCase={activeCase}
          wsReady={wsReady}
          nurseName={nurseName}
          inductionPhysicianName={inductionPhysicianName}
          onChangeInductionPhysician={onChangeInductionPhysician}
          onEndShift={onEndShift}
        />

        <main className="min-h-0 min-w-0 flex-1 overflow-hidden bg-[#F4F7FB] lg:bg-white">
          <div className="mx-auto grid h-full w-full min-w-0 max-w-7xl overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)]">
            <div className="nurse-console-scroll flex min-h-full min-w-0 flex-col overflow-y-auto px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-8 sm:py-5">
              <CaseProgressPanel
                activeCase={activeCase}
                nextCase={selectedRoomCase ?? nextCase}
                nextCaseLabel={selectedRoomCase ? 'Selected case' : undefined}
                embedded
                onTransition={async (phase) => {
                  await handleButtonTransition(phase, selectedRoomCase?.case_code)
                  setSelectedCaseCode(null)
                }}
                onRequestCancellation={handleRequestCancellation}
              />
              <RoomCaseQueue
                cases={roomCases}
                activeCase={activeCase}
                nextCase={nextCase}
                selectedCaseCode={selectedCaseCode}
                onSelect={setSelectedCaseCode}
              />
              <button
                type="button"
                onClick={() => setStartSheetOpen(true)}
                className="touch-dock-alternative mt-auto flex h-13 w-full shrink-0 touch-manipulation items-center justify-center gap-2 rounded-xl border border-[#CBD5E1] bg-white text-sm font-black text-[#334155] shadow-sm active:scale-[0.99] sm:mt-5"
              >
                <ListBulletIcon className="h-5 w-5" />
                Browse all cases
              </button>
            </div>

            <div className="hidden h-full min-h-0 lg:block">
              <LargeVoicePanel
                orbState={orbState}
                amplitude={amplitude}
                wsReady={wsReady}
                vadMode={vadMode}
                pttHotkey={pttHotkey}
                onPushToTalkStart={startPTT}
                onPushToTalkEnd={endPTT}
                onVadModeChange={setVadMode}
              />
            </div>
          </div>
        </main>

        <div className="hidden lg:block">
          <CommandBar lastCmd={lastCmd} />
        </div>
      </div>

      {vadMode === 'ptt' && (
        <TouchVoiceDock
          orbState={orbState}
          wsReady={wsReady}
          onOpenCases={() => setStartSheetOpen(true)}
          onPushToTalkStart={startPTT}
          onPushToTalkEnd={endPTT}
        />
      )}

      <StartCaseSheet
        open={startSheetOpen}
        room={room}
        cases={allCases}
        activeCase={activeCase}
        onStart={handleStartCase}
        onClose={() => setStartSheetOpen(false)}
      />

      {activeCase?.delay_reason_required && (
        <DelayReasonModal caseItem={activeCase} onSubmitted={refreshCase} />
      )}
    </>
  )
}

function RoomLease({ room }: { room: string }) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [inductionPhysicianName, setInductionPhysicianName] = useState('')
  const [physicians, setPhysicians] = useState<InductionPhysician[]>([])
  const [selectedPhysicianId, setSelectedPhysicianId] = useState('')
  const [physicianQuery, setPhysicianQuery] = useState('')
  const [editingPhysician, setEditingPhysician] = useState(false)
  const [savingPhysician, setSavingPhysician] = useState(false)
  const [loadingPhysicians, setLoadingPhysicians] = useState(true)
  const [shiftStarted, setShiftStarted] = useState(
    () => Boolean(sessionStorage.getItem(`client-session:${room}`)) || localStorage.getItem(SHIFT_ROOM_KEY) === room,
  )
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const storageKey = `client-session:${room}`
  const physicianStorageKey = `client-physician:${room}`

  function clearLocalShift() {
    sessionStorage.removeItem(storageKey)
    sessionStorage.removeItem(physicianStorageKey)
    localStorage.removeItem(SHIFT_ROOM_KEY)
    notifyShiftRoomChanged()
    setSessionId(null)
    setInductionPhysicianName('')
  }

  useEffect(() => {
    let alive = true

    async function loadPhysicians() {
      try {
        const res = await listInductionPhysicians()
        if (!alive) return
        setPhysicians(res.data)
        setSelectedPhysicianId(res.data[0]?.id ?? '')
      } catch {
        if (alive) setError('Unable to load induction physicians.')
      } finally {
        if (alive) setLoadingPhysicians(false)
      }
    }

    loadPhysicians()
    return () => { alive = false }
  }, [storageKey])

  useEffect(() => {
    if (!shiftStarted) return
    let alive = true
    let heartbeat: number | undefined

    async function claim() {
      try {
        const existing = sessionStorage.getItem(storageKey)
        // Always pass physician ID — from selection (new shift) or stored (re-claim)
        const storedPhysicianId = sessionStorage.getItem(physicianStorageKey)
        const physicianId = selectedPhysicianId || storedPhysicianId || null
        const res = await claimClientRoom(room, existing, physicianId)
        if (!alive) return
        localStorage.setItem(SHIFT_ROOM_KEY, room)
        notifyShiftRoomChanged()
        sessionStorage.setItem(storageKey, res.data.session_id)
        sessionStorage.setItem(physicianStorageKey, res.data.induction_physician_id)
        setSessionId(res.data.session_id)
        setInductionPhysicianName(res.data.induction_physician_name)
        heartbeat = window.setInterval(async () => {
          try {
            const current = sessionStorage.getItem(storageKey)
            const savedPhysicianId = sessionStorage.getItem(physicianStorageKey)
            const res = await claimClientRoom(room, current, savedPhysicianId)
            sessionStorage.setItem(storageKey, res.data.session_id)
            sessionStorage.setItem(physicianStorageKey, res.data.induction_physician_id)
            if (alive) setInductionPhysicianName(res.data.induction_physician_name)
          } catch {
            if (alive) setError('This room session expired or was taken. Return to room selection.')
          }
        }, 15_000)
      } catch (err: any) {
        if (!alive) return
        if (err?.response?.status === 422 && sessionStorage.getItem(storageKey)) {
          clearLocalShift()
          setShiftStarted(false)
          setError('Previous room session expired. Choose the induction physician again.')
          return
        }
        setError(err?.response?.data?.detail ?? `${room} is already in use.`)
      }
    }

    claim()

    return () => {
      alive = false
      if (heartbeat) window.clearInterval(heartbeat)
    }
  // selectedPhysicianId intentionally omitted: re-claiming an existing session
  // doesn't need a physician ID, and including it would re-trigger claim() when
  // the physician list loads after a page refresh, creating a duplicate shift.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, shiftStarted, storageKey])

  function startShift() {
    if (!selectedPhysicianId) {
      setError('Choose an induction physician before starting the shift.')
      return
    }
    setError('')
    setShiftStarted(true)
  }

  async function changeInductionPhysician() {
    if (!selectedPhysicianId) {
      setError('Choose an induction physician.')
      return
    }
    const current = sessionStorage.getItem(storageKey)
    if (!current) {
      setError('Room session is not active. Reopen the room before changing the induction physician.')
      return
    }

    setSavingPhysician(true)
    setError('')
    try {
      const res = await claimClientRoom(room, current, selectedPhysicianId)
      sessionStorage.setItem(storageKey, res.data.session_id)
      sessionStorage.setItem(physicianStorageKey, res.data.induction_physician_id)
      setSessionId(res.data.session_id)
      setInductionPhysicianName(res.data.induction_physician_name)
      setEditingPhysician(false)
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Unable to change induction physician.')
    } finally {
      setSavingPhysician(false)
    }
  }

  async function endShift() {
    const current = sessionStorage.getItem(storageKey)
    try { await releaseClientRoom(room, current) } catch {}
    clearLocalShift()
    navigate('/control', { replace: true })
  }

  if (error && !shiftStarted) {
    return (
      <div className="flex min-h-[calc(100dvh-var(--app-nav-height))] items-center justify-center bg-white px-6">
        <div className="w-full max-w-sm border border-[#E2E8F0] p-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#94A3B8]">{room}</p>
          <h1 className="mt-2 text-lg font-bold text-[#0F172A]">Room unavailable</h1>
          <p className="mt-2 text-sm text-[#64748B]">{error}</p>
          <button
            type="button"
            onClick={() => navigate('/control')}
            className="mt-5 h-10 w-full rounded-sm bg-[#0F2044] text-xs font-semibold uppercase tracking-wide text-white"
          >
            Back to rooms
          </button>
        </div>
      </div>
    )
  }

  if (!shiftStarted) {
    const selectedPhysician = physicians.find((p) => p.id === selectedPhysicianId)
    return (
      <div className="flex h-[calc(100dvh-var(--app-nav-height))] overflow-hidden bg-white">

        {/* Left sidebar — context */}
        <div className="hidden w-56 shrink-0 flex-col border-r border-[#E2E8F0] px-6 py-6 md:flex">
          <div className="flex items-center gap-2">
            <span className="bg-[#0F2044] px-2.5 py-1 text-xs font-black text-white">{room}</span>
            <span className="text-[10px] font-black uppercase tracking-widest text-[#94A3B8]">Mic client</span>
          </div>
          <div className="mt-8">
            <h1 className="text-2xl font-black leading-snug tracking-tight text-[#0F172A]">Start<br />Shift</h1>
            <p className="mt-3 text-xs font-semibold leading-relaxed text-[#64748B]">
              Choose the induction physician assigned to this room.
            </p>
          </div>
          {selectedPhysician && (
            <div className="mt-auto border-t border-[#E2E8F0] pt-5">
              <div className="text-[10px] font-black uppercase tracking-widest text-[#94A3B8]">Selected</div>
              <div className="mt-1.5 text-sm font-black text-[#0F172A]">Dr. {selectedPhysician.first_name} {selectedPhysician.last_name}</div>
              <div className="mt-0.5 text-[10px] font-black uppercase tracking-widest text-[#94A3B8]">
                {selectedPhysician.first_name[0]}{selectedPhysician.last_name[0]}
              </div>
            </div>
          )}
        </div>

        {/* Right — search + list + footer */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">

          {/* Search header */}
          <div className="shrink-0 border-b border-[#E2E8F0] px-4 py-4 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[10px] font-black uppercase tracking-widest text-[#94A3B8]">Induction physician</div>
              <span className="bg-[#0F2044] px-2 py-1 text-[10px] font-black text-white md:hidden">{room}</span>
            </div>
            <div className="mt-2 flex h-9 items-center gap-2 border border-[#CBD5E1] px-3 focus-within:border-[#0F2044]">
              <svg className="h-3.5 w-3.5 shrink-0 text-[#94A3B8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              <input
                type="search"
                value={physicianQuery}
                onChange={(e) => setPhysicianQuery(e.target.value)}
                placeholder="Search by name or initials"
                className="h-full min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#0F172A] outline-none placeholder:font-semibold placeholder:text-[#94A3B8]"
                autoComplete="off"
                autoFocus
              />
            </div>
          </div>

          {/* Scrollable list */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <InductionPhysicianPicker
              physicians={physicians}
              selectedPhysicianId={selectedPhysicianId}
              query={physicianQuery}
              loading={loadingPhysicians}
              onQueryChange={setPhysicianQuery}
              onSelect={setSelectedPhysicianId}
            />
          </div>

          {/* Footer */}
          <div className="shrink-0 border-t border-[#E2E8F0] px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-6">
            {error && (
              <div className="mb-3 border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-xs font-semibold text-[#B91C1C]">{error}</div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => navigate('/control')}
                className="h-9 flex-1 border border-[#CBD5E1] text-xs font-black uppercase tracking-wide text-[#475569] hover:bg-[#F8FAFC]"
              >
                Back
              </button>
              <button
                type="button"
                disabled={loadingPhysicians || !selectedPhysicianId}
                onClick={startShift}
                className="h-9 flex-[2] bg-[#0F2044] text-xs font-black uppercase tracking-wide text-white hover:bg-[#19315F] disabled:opacity-40"
              >
                Start shift
              </button>
            </div>
          </div>

        </div>
      </div>
    )
  }

  if (!sessionId) {
    return (
      <div className="flex min-h-[calc(100dvh-var(--app-nav-height))] items-center justify-center bg-white">
        <div className="text-sm font-semibold text-[#64748B]">Opening {room}...</div>
      </div>
    )
  }

  const selectedPhysician = physicians.find((p) => p.id === selectedPhysicianId)

  return (
    <>
      <ClientConsole
        room={room}
        inductionPhysicianName={inductionPhysicianName}
        onChangeInductionPhysician={() => {
          const storedPhysicianId = sessionStorage.getItem(physicianStorageKey)
          if (storedPhysicianId) setSelectedPhysicianId(storedPhysicianId)
          setPhysicianQuery('')
          setEditingPhysician(true)
        }}
        onEndShift={endShift}
      />

      {editingPhysician && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-[#0F172A]/35 px-4">
          <div className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden border border-[#CBD5E1] bg-white shadow-xl">
            <div className="shrink-0 border-b border-[#E2E8F0] px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-[#94A3B8]">{room}</div>
                  <div className="mt-1 text-lg font-black text-[#0F172A]">Change induction physician</div>
                  {selectedPhysician && (
                    <div className="mt-1 text-xs font-semibold text-[#64748B]">
                      Selected: Dr. {selectedPhysician.first_name} {selectedPhysician.last_name}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setEditingPhysician(false)}
                  className="h-8 rounded-sm border border-[#CBD5E1] px-3 text-[10px] font-black uppercase tracking-wide text-[#475569] hover:bg-[#F8FAFC]"
                >
                  Close
                </button>
              </div>
              <div className="mt-3 flex h-9 items-center gap-2 border border-[#CBD5E1] px-3 focus-within:border-[#0F2044]">
                <svg className="h-3.5 w-3.5 shrink-0 text-[#94A3B8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                </svg>
                <input
                  type="search"
                  value={physicianQuery}
                  onChange={(e) => setPhysicianQuery(e.target.value)}
                  placeholder="Search by name or initials"
                  className="h-full min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#0F172A] outline-none placeholder:font-semibold placeholder:text-[#94A3B8]"
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <InductionPhysicianPicker
                physicians={physicians}
                selectedPhysicianId={selectedPhysicianId}
                query={physicianQuery}
                loading={loadingPhysicians}
                onQueryChange={setPhysicianQuery}
                onSelect={setSelectedPhysicianId}
              />
            </div>

            <div className="shrink-0 border-t border-[#E2E8F0] px-5 py-4">
              {error && (
                <div className="mb-3 border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-xs font-semibold text-[#B91C1C]">{error}</div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditingPhysician(false)}
                  className="h-9 flex-1 border border-[#CBD5E1] text-xs font-black uppercase tracking-wide text-[#475569] hover:bg-[#F8FAFC]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={savingPhysician || loadingPhysicians || !selectedPhysicianId}
                  onClick={changeInductionPhysician}
                  className="h-9 flex-[2] bg-[#0F2044] text-xs font-black uppercase tracking-wide text-white hover:bg-[#19315F] disabled:opacity-40"
                >
                  {savingPhysician ? 'Saving...' : 'Save physician'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Main client page ─────────────────────────────────────────────────────────

export default function ClientPage() {
  const { roomCode } = useParams<{ roomCode: string }>()
  const room = roomCode?.toUpperCase() ?? ''
  const { token, role } = useAuthStore()

  if (!VALID_ROOMS.includes(room)) return <Navigate to="/display" replace />
  if (!token) return <Navigate to="/login" replace />
  if (role !== 'nurse') return <Navigate to={role === 'admin' ? '/admin' : '/login'} replace />

  return <RoomLease room={room} />
}
