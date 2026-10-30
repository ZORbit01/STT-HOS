import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useClientVoice } from '../../hooks/useClientVoice'
import { useAuthStore } from '../../store/useAuthStore'
import { Orb } from './components/Orb'
import { ClientVoiceContext, useClientVoiceSession } from './clientVoiceSession'
import { SHIFT_ROOM_EVENT, SHIFT_ROOM_KEY } from './shiftRoom'
import { OVERLAY_OPEN_KEY, OVERLAY_EVENT } from './voiceOverlay'
import type { OrbState } from './types'

function getShiftRoom() {
  return localStorage.getItem(SHIFT_ROOM_KEY)
}

function ClientVoiceRuntime({ room, children }: { room: string; children: ReactNode }) {
  const voice = useClientVoice(room)
  const value = useMemo(() => ({ ...voice, room }), [voice, room])

  return (
    <ClientVoiceContext.Provider value={value}>
      {children}
    </ClientVoiceContext.Provider>
  )
}

export function ClientVoiceProvider({ children }: { children: ReactNode }) {
  const [room, setRoom] = useState(getShiftRoom)
  const role = useAuthStore((auth) => auth.role)

  useEffect(() => {
    function syncRoom() {
      setRoom(getShiftRoom())
    }

    window.addEventListener('storage', syncRoom)
    window.addEventListener(SHIFT_ROOM_EVENT, syncRoom)
    return () => {
      window.removeEventListener('storage', syncRoom)
      window.removeEventListener(SHIFT_ROOM_EVENT, syncRoom)
    }
  }, [])

  return (
    <>
      {role === 'nurse' && room ? <ClientVoiceRuntime room={room}>{children}</ClientVoiceRuntime> : children}
    </>
  )
}

const ORB_LABEL: Record<OrbState, string> = {
  idle: 'Hold to speak',
  wake_ready: 'Say "Hey Sina"',
  listening: 'Listening...',
  processing: 'Processing...',
  accepted: 'Accepted',
  rejected: 'Try again',
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

const OVERLAY_POSITION_KEY = 'client:sina-overlay-position'

function readOverlayPosition() {
  try {
    const saved = JSON.parse(localStorage.getItem(OVERLAY_POSITION_KEY) ?? '{}')
    if (typeof saved.x === 'number' && typeof saved.y === 'number') return saved as { x: number; y: number }
  } catch {}
  return { x: window.innerWidth - 264, y: window.innerHeight - 120 }
}

export function ClientVoiceOverlay() {
  const voice = useClientVoiceSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [position, setPosition] = useState(readOverlayPosition)
  const [dragging, setDragging] = useState(false)
  const [forcedOpen, setForcedOpen] = useState(() => localStorage.getItem(OVERLAY_OPEN_KEY) === 'true')
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    function onResize() {
      setPosition((current) => clampPosition(current))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    function syncOpen() {
      const isOpen = localStorage.getItem(OVERLAY_OPEN_KEY) === 'true'
      setForcedOpen(isOpen)
      if (isOpen) setDismissed(false)
    }

    window.addEventListener('storage', syncOpen)
    window.addEventListener(OVERLAY_EVENT, syncOpen)
    return () => {
      window.removeEventListener('storage', syncOpen)
      window.removeEventListener(OVERLAY_EVENT, syncOpen)
    }
  }, [])

  if (!voice || !voice.deviceReady || !voice.nurseToken) return null
  if (dismissed) return null
  if (location.pathname.startsWith('/client/') && !forcedOpen) return null

  const label = voice.orbState === 'idle'
    ? (voice.wsReady ? ORB_LABEL.idle : 'Reconnecting...')
    : ORB_LABEL[voice.orbState]

  function clampPosition(next: { x: number; y: number }) {
    const width = 244
    const height = 88
    return {
      x: Math.max(8, Math.min(window.innerWidth - width - 8, next.x)),
      y: Math.max(56, Math.min(window.innerHeight - height - 8, next.y)),
    }
  }

  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const startX = event.clientX
    const startY = event.clientY
    const startPosition = position
    setDragging(false)
    event.currentTarget.setPointerCapture(event.pointerId)

    function move(moveEvent: PointerEvent) {
      const dx = moveEvent.clientX - startX
      const dy = moveEvent.clientY - startY
      if (Math.abs(dx) + Math.abs(dy) > 4) setDragging(true)
      setPosition(clampPosition({ x: startPosition.x + dx, y: startPosition.y + dy }))
    }

    function up(upEvent: PointerEvent) {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const dx = upEvent.clientX - startX
      const dy = upEvent.clientY - startY
      const next = clampPosition({ x: startPosition.x + dx, y: startPosition.y + dy })
      setPosition(next)
      localStorage.setItem(OVERLAY_POSITION_KEY, JSON.stringify(next))
      window.setTimeout(() => setDragging(false), 0)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      title="Drag to move. Double-click to open mic client."
      onPointerDown={startDrag}
      onDoubleClick={() => {
        if (!dragging) {
          localStorage.removeItem(OVERLAY_OPEN_KEY)
          window.dispatchEvent(new Event(OVERLAY_EVENT))
          navigate(`/client/${voice.room}`)
        }
      }}
      className="fixed z-[100] flex cursor-grab touch-none select-none items-center gap-3 rounded-xl border border-[#D7DEE8] bg-white/95 p-2.5 shadow-lg backdrop-blur active:cursor-grabbing"
      style={{ left: position.x, top: position.y, width: 244 }}
    >
      <button
        type="button"
        aria-label="Close voice window"
        onPointerDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onDoubleClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          localStorage.removeItem(OVERLAY_OPEN_KEY)
          window.dispatchEvent(new Event(OVERLAY_EVENT))
          setDismissed(true)
        }}
        className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-md text-[11px] font-black text-[#94A3B8] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
      >
        ×
      </button>
      <button
        type="button"
        aria-label={voice.vadMode === 'ptt' ? 'Press and hold to speak' : 'Sina voice status'}
        disabled={voice.vadMode !== 'ptt'}
        onPointerDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (voice.vadMode !== 'ptt') return
          event.currentTarget.setPointerCapture(event.pointerId)
          voice.startPTT()
        }}
        onPointerUp={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (voice.vadMode === 'ptt') voice.endPTT()
        }}
        onPointerCancel={voice.endPTT}
        onLostPointerCapture={voice.endPTT}
        onContextMenu={(event) => event.preventDefault()}
        className="flex h-16 w-16 shrink-0 touch-none items-center justify-center overflow-visible rounded-full outline-none transition active:scale-95 focus-visible:ring-4 focus-visible:ring-cyan-200 disabled:cursor-default"
      >
        <div className="scale-[0.44]">
          <Orb state={voice.orbState} amplitude={voice.amplitude} size="compact" />
        </div>
      </button>
      <div className="min-w-0 flex-1 pr-4">
        <div className="flex items-center gap-2">
          <span className="rounded bg-[#0F2044] px-1.5 py-0.5 text-[9px] font-black text-white">{voice.room}</span>
          <span className={`h-2 w-2 rounded-full ${voice.wsReady ? 'bg-[#16A34A]' : 'bg-[#DC2626]'}`} />
        </div>
        <p className="mt-1.5 truncate text-sm font-black" style={{ color: ORB_LABEL_COLOR[voice.orbState] }}>
          {label}
        </p>
        <p className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-[#94A3B8]">
          {voice.vadMode === 'wake' ? 'Sina listening' : 'Press and hold mic'}
        </p>
      </div>
    </div>
  )
}
