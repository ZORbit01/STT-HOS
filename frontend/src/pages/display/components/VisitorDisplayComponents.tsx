import { type ReactNode, useEffect, useRef, useState } from 'react'
import type { CasePhase, ScreenCase, ScreenFeedEvent, ScreenFeedKind, ScreenRoom, ScreenTimingStatus } from '../../../types'

const PHASE_STEPS: CasePhase[] = ['IN', 'INDUCTION', 'INCISION', 'CLOSURE', 'OUT', 'CLEANING']

const PHASE_SHORT: Record<CasePhase, string> = {
  IDLE: 'Idle',
  IN: 'In',
  INDUCTION: 'Induction',
  INCISION: 'Incision',
  CLOSURE: 'Closure',
  OUT: 'Out',
  CLEANING: 'Cleaning',
  COMPLETE: 'Complete',
  CANCELLED: 'Cancelled',
}

const PHASE_COLOR: Record<CasePhase, string> = {
  IDLE: '#A8A29E',
  IN: '#0EA5E9',
  INDUCTION: '#14B8A6',
  INCISION: '#F59E0B',
  CLOSURE: '#A78BFA',
  OUT: '#6EE7B7',
  CLEANING: '#34D399',
  COMPLETE: '#4ADE80',
  CANCELLED: '#F87171',
}

const PHASE_ICON: Record<CasePhase, ReactNode> = {
  IDLE: <></>,
  COMPLETE: <></>,
  CANCELLED: <></>,
  IN: (
    <svg viewBox="0 0 16 16" fill="none" className="h-[55%] w-[55%]">
      <rect x="2" y="2" width="7" height="12" rx="0.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 8h4M12 6l2 2-2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="0.8" fill="currentColor" />
    </svg>
  ),
  INDUCTION: (
    <svg viewBox="0 0 16 16" fill="none" className="h-[55%] w-[55%]">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 8.2 7 10.2 11.5 5.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  INCISION: (
    <svg viewBox="0 0 16 16" fill="none" className="h-[55%] w-[55%]">
      <path d="M2 14 9 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M9 7 13 4 14 6 11 9Z" fill="currentColor" />
      <path d="M13 4 14 6" stroke="currentColor" strokeWidth="0.6" strokeLinecap="round" />
    </svg>
  ),
  CLOSURE: (
    <svg viewBox="0 0 16 16" fill="none" className="h-[58%] w-[58%]">
      <path d="M2 8Q8 7.2 14 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="5" y1="6" x2="5" y2="10" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <line x1="8" y1="5.5" x2="8" y2="10.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <line x1="11" y1="6" x2="11" y2="10" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <circle cx="5" cy="6" r="0.7" fill="currentColor" />
      <circle cx="5" cy="10" r="0.7" fill="currentColor" />
      <circle cx="8" cy="5.5" r="0.7" fill="currentColor" />
      <circle cx="8" cy="10.5" r="0.7" fill="currentColor" />
      <circle cx="11" cy="6" r="0.7" fill="currentColor" />
      <circle cx="11" cy="10" r="0.7" fill="currentColor" />
    </svg>
  ),
  OUT: (
    <svg viewBox="0 0 16 16" fill="none" className="h-[55%] w-[55%]">
      <rect x="7" y="2" width="7" height="12" rx="0.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6 8H2M4 6 2 8l2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="0.8" fill="currentColor" />
    </svg>
  ),
  CLEANING: (
    <svg viewBox="0 0 16 16" fill="none" className="h-[58%] w-[58%]">
      <line x1="11" y1="2" x2="5" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M2 12Q4 10.5 8 11.5 6 13.5 2 14Z" fill="currentColor" opacity="0.85" />
      <line x1="3" y1="12.2" x2="2.5" y2="14" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
      <line x1="5" y1="12" x2="4.5" y2="13.8" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
      <line x1="6.5" y1="12.2" x2="6.2" y2="13.5" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
    </svg>
  ),
}

const STATUS_COLOR: Record<ScreenTimingStatus, { track: string; glow: string; text: string; bg: string; border: string }> = {
  SCHEDULED: { track: '#A8A29E', glow: '#D6D3D1', text: '#78716C', bg: '#FAFAF9', border: '#E7E5E4' },
  IN_PROGRESS: { track: '#0EA5E9', glow: '#7DD3FC', text: '#0369A1', bg: '#F0F9FF', border: '#BAE6FD' },
  NEAR_END:    { track: '#F59E0B', glow: '#FDE68A', text: '#92400E', bg: '#FFFBEB', border: '#FDE68A' },
  OVERRUN:     { track: '#F59E0B', glow: '#FDE68A', text: '#92400E', bg: '#FFFBEB', border: '#FDE68A' },
  CRITICAL_OVERRUN: { track: '#EF4444', glow: '#FCA5A5', text: '#991B1B', bg: '#FFF5F5', border: '#FECACA' },
  COMPLETE:    { track: '#34D399', glow: '#A7F3D0', text: '#065F46', bg: '#ECFDF5', border: '#A7F3D0' },
  IDLE:        { track: '#A8A29E', glow: '#D6D3D1', text: '#78716C', bg: '#FAFAF9', border: '#E7E5E4' },
}

const NEWS_STYLE: Record<ScreenFeedKind, { accent: string; label: string; bg: string; text: string }> = {
  reschedule: { accent: '#F59E0B', label: 'Rescheduled', bg: '#FFFBEB', text: '#92400E' },
  phase: { accent: '#3B82F6', label: 'Live update', bg: '#EFF6FF', text: '#1D4ED8' },
  timing: { accent: '#F59E0B', label: 'Timing update', bg: '#FFFBEB', text: '#92400E' },
  complete: { accent: '#22C55E', label: 'Complete', bg: '#F0FDF4', text: '#15803D' },
  system: { accent: '#64748B', label: 'Schedule', bg: '#F8FAFC', text: '#475569' },
}

const ROOM_MOVE_STYLE = { accent: '#8B5CF6', label: 'Room changed', bg: '#F5F3FF', text: '#5B21B6' }

type VisitorFeedItem = ScreenFeedEvent & { collapsed_count?: number }

function fmt(value: string | Date) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function PipelineNode({ step, state, timingStatus }: {
  step: CasePhase
  state: 'done' | 'active' | 'upcoming'
  timingStatus: ScreenTimingStatus
}) {
  const activeColor = timingStatus === 'IN_PROGRESS' ? PHASE_COLOR[step] : STATUS_COLOR[timingStatus].track
  const color = state === 'done' ? '#22C55E' : state === 'active' ? activeColor : '#E2E8F0'
  const borderColor = state === 'done' ? '#16A34A' : state === 'active' ? activeColor : '#CBD5E1'

  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5">
      <div className="relative flex h-[clamp(3rem,5vw,5rem)] w-full items-center justify-center">
        {state === 'active' && <div className="absolute h-[clamp(2.75rem,4.5vw,4.5rem)] w-[clamp(2.75rem,4.5vw,4.5rem)] rounded-full" style={{ backgroundColor: STATUS_COLOR[timingStatus].glow, animation: 'node-pulse 2s ease-out infinite' }} />}
        {state === 'active' && <div className="absolute h-[clamp(2.5rem,4vw,4rem)] w-[clamp(2.5rem,4vw,4rem)] rounded-full opacity-30" style={{ backgroundColor: activeColor }} />}
        <div
          className={`relative z-10 flex items-center justify-center rounded-full border-2 shadow-md transition-all duration-500 ${
            state === 'active'
              ? 'h-[clamp(2.5rem,4vw,4rem)] w-[clamp(2.5rem,4vw,4rem)]'
              : state === 'done'
                ? 'h-[clamp(2.25rem,3.4vw,3.375rem)] w-[clamp(2.25rem,3.4vw,3.375rem)]'
                : 'h-[clamp(2rem,3vw,2.875rem)] w-[clamp(2rem,3vw,2.875rem)]'
          }`}
          style={{
            backgroundColor: color,
            borderColor,
            boxShadow: state === 'active' ? `0 0 0 4px ${activeColor}33` : state === 'done' ? '0 0 0 3px #86EFAC55' : 'none',
          }}
        >
          {state === 'done' ? (
            <svg viewBox="0 0 14 14" className="h-7 w-7" fill="none"><path d="M2.5 7l3 3 6-6" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          ) : (
            <span className="flex h-full w-full items-center justify-center" style={{ color: state === 'active' ? 'white' : '#A0AEC0' }}>
              {PHASE_ICON[step]}
            </span>
          )}
        </div>
      </div>
      <span className="max-w-full truncate whitespace-nowrap text-[clamp(0.55rem,0.9vw,0.875rem)] font-black uppercase tracking-normal xl:tracking-wide" style={{ color: state === 'active' ? STATUS_COLOR[timingStatus].text : state === 'done' ? '#15803D' : '#94A3B8' }}>
        {PHASE_SHORT[step]}
      </span>
    </div>
  )
}

function ProgressBar({ activeCase }: { activeCase: ScreenCase }) {
  const fillRef = useRef<HTMLDivElement>(null)
  const endLabelRef = useRef<HTMLSpanElement>(null)
  const startMs = new Date(activeCase.display_start).getTime()
  const endMs = new Date(activeCase.planned_end).getTime()
  const total = Math.max(1, endMs - startMs)
  const color = STATUS_COLOR[activeCase.timing_status].track
  const isOverrun = activeCase.timing_status === 'OVERRUN' || activeCase.timing_status === 'CRITICAL_OVERRUN'

  useEffect(() => {
    function tick() {
      const now = Date.now()
      const el = fillRef.current
      if (el) {
        const pct = Math.min(112, Math.max(0, ((now - startMs) / total) * 100))
        el.style.width = `${pct}%`
      }
      const label = endLabelRef.current
      if (label && now > endMs) {
        label.textContent = fmt(new Date(now))
      }
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [startMs, endMs, total])

  return (
    <div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#F1F5F9]">
        <div ref={fillRef} className="h-full rounded-full transition-[width,background-color] duration-1000" style={{ width: '0%', backgroundColor: color }} />
      </div>
      <div className="mt-1 flex justify-between font-mono text-xl font-black tracking-tight text-gray-900">
        <span>{fmt(activeCase.display_start)}</span>
        <span ref={endLabelRef} style={{ color: isOverrun ? color : undefined }}>{fmt(activeCase.planned_end)}</span>
      </div>
    </div>
  )
}

function UpcomingCases({ cases }: { cases: ScreenCase[] }) {
  const [idx, setIdx] = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (cases.length <= 1) return
    const timer = window.setInterval(() => {
      setVisible(false)
      window.setTimeout(() => {
        setIdx((value) => (value + 1) % cases.length)
        setVisible(true)
      }, 350)
    }, 3500)
    return () => window.clearInterval(timer)
  }, [cases.length])

  if (cases.length === 0) return null
  const current = cases[idx % cases.length]

  return (
    <div className="mt-2 border-t border-[#F1F5F9] pt-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Next Up</span>
        <span className="font-mono text-sm font-black text-gray-800">{fmt(current.display_start)}</span>
      </div>
      <div className="transition-all duration-300" style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(5px)' }}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 text-sm font-black text-gray-900">{current.public_patient_label}</span>
              <span className="truncate text-xs font-bold text-gray-700">{current.procedure_label}</span>
            </div>
            <span className="text-xs font-semibold text-gray-500">{current.physician_label}</span>
          </div>
          <span className="shrink-0 text-xs font-semibold text-gray-400">{current.estimated_duration_min} min</span>
        </div>
      </div>
    </div>
  )
}

export function VisitorRoomCard({ room, activeCase, upcomingCases }: {
  room: ScreenRoom
  activeCase: ScreenCase | undefined
  upcomingCases: ScreenCase[]
}) {
  const phase = activeCase?.current_phase ?? 'IDLE'
  const timing = activeCase?.timing_status ?? 'IDLE'
  const isActive = Boolean(activeCase)
  const currentIdx = PHASE_STEPS.indexOf(phase)
  const colors = STATUS_COLOR[timing]
  const isOverrun = timing === 'OVERRUN' || timing === 'CRITICAL_OVERRUN'

  return (
    <div className="relative flex min-h-[290px] flex-col overflow-hidden rounded-2xl border bg-white transition-all duration-500 sm:min-h-0" style={{ borderColor: colors.border, boxShadow: isActive ? `0 4px 24px 0 ${colors.glow}55` : '0 1px 4px 0 #0001' }}>
      {isOverrun && <div className="absolute inset-x-0 top-0 h-1.5 animate-pulse" style={{ backgroundColor: colors.track }} />}
      <div className="h-1 w-full rounded-t-2xl transition-all duration-700" style={{ backgroundColor: isActive ? colors.track : '#E2E8F0' }} />
      <div className="flex flex-1 flex-col p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex flex-col">
              <span className="text-2xl font-black leading-none tracking-tight text-gray-900">{room.room_code}</span>
              <span className="mt-0.5 text-[10px] font-bold uppercase tracking-widest" style={{ color: isActive ? colors.text : '#94A3B8' }}>{room.phase_label}</span>
            </div>
            {activeCase && (
              <div className="border-l border-gray-100 pl-2.5">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-black text-gray-900">{activeCase.public_patient_label}</span>
                </div>
                <div className="max-w-[220px] truncate text-xs font-bold text-gray-700">{activeCase.procedure_label}</div>
              </div>
            )}
          </div>
          {activeCase && (
            <div className="shrink-0 text-right">
              <div className="font-mono text-xl font-black tracking-tight text-gray-900">{fmt(activeCase.display_start)} – {fmt(activeCase.planned_end)}</div>
              {activeCase.overrun_minutes > 0 && (
                <div className="mt-1 text-center">
                  <div className="text-lg font-black leading-none" style={{ color: colors.text }}>+{activeCase.overrun_minutes}m</div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-2 flex-1">
          <div className="flex min-w-0 items-start">
            {PHASE_STEPS.map((step, index) => {
              const nodeState: 'done' | 'active' | 'upcoming' = !isActive ? 'upcoming' : index < currentIdx ? 'done' : index === currentIdx ? 'active' : 'upcoming'
              return (
                <div key={step} className="flex min-w-0 flex-1 items-start">
                  <div className="min-w-0 flex-1"><PipelineNode step={step} state={nodeState} timingStatus={timing} /></div>
                  {index < PHASE_STEPS.length - 1 && <div className="-mx-1 flex h-[clamp(3rem,5vw,5rem)] w-[clamp(0.35rem,1vw,1.25rem)] shrink-0 items-center"><div className="h-1 w-full rounded-full transition-all duration-700" style={{ backgroundColor: isActive && index < currentIdx ? '#4ADE80' : '#E2E8F0' }} /></div>}
                </div>
              )
            })}
          </div>
          {activeCase && <ProgressBar activeCase={activeCase} />}
        </div>

        <UpcomingCases cases={upcomingCases} />
      </div>
    </div>
  )
}

export function VisitorLiveNewsFeed({ notifications, freshIds }: { notifications: VisitorFeedItem[]; freshIds: Set<string> }) {
  const [clock, setClock] = useState(new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="flex h-36 w-full shrink-0 flex-col overflow-hidden border-t border-[#E2E8F0] bg-[#F8FAFC] xl:h-auto xl:w-60 xl:border-l xl:border-t-0 2xl:w-72">
      <div className="shrink-0 border-b border-[#E2E8F0] bg-white px-3 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping bg-red-400 opacity-75" /><span className="relative inline-flex h-1.5 w-1.5 bg-red-500" /></span>
            <span className="text-[10px] font-black uppercase tracking-widest text-[#0F172A]">Live Updates</span>
          </div>
          <span className="font-mono text-[10px] font-semibold text-[#94A3B8]">{clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center"><span className="text-[10px] uppercase tracking-widest text-[#CBD5E1]">Awaiting updates</span></div>
        ) : notifications.map((notif) => {
          const isRoomMove = notif.kind === 'reschedule' && Boolean(notif.metadata?.from_room && notif.metadata?.to_room)
          const style = isRoomMove ? ROOM_MOVE_STYLE : NEWS_STYLE[notif.kind]
          const isFresh = freshIds.has(notif.id)
          return (
            <div
              key={notif.id}
              className={`border-b border-[#E2E8F0] bg-white transition-colors duration-1000 ${isFresh ? 'feed-card-updated' : ''}`}
            >
              <div className="h-[3px] w-full" style={{ backgroundColor: style.accent }} />
              <div className="px-3 py-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-black text-[#0F172A]" style={{ borderLeft: `3px solid ${style.accent}`, paddingLeft: 6 }}>
                      {isRoomMove ? `${notif.metadata?.from_room} → ${notif.metadata?.to_room}` : (notif.room_code ?? 'ALL')}
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: style.accent }}>{style.label}</span>
                  </div>
                  <span className="font-mono text-[10px] font-semibold text-[#94A3B8] shrink-0">{fmt(notif.created_at)}</span>
                </div>
                <p className="text-base font-bold leading-snug text-[#0F172A]">{notif.message}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export const visitorDisplayAnimationStyles = `
  @keyframes node-pulse {
    0% { transform: scale(1); opacity: 0.5; }
    100% { transform: scale(1.45); opacity: 0; }
  }
  @keyframes feed-card-updated {
    0% { transform: translateY(-10px) scale(0.985); opacity: 0.2; }
    55% { transform: translateY(2px) scale(1.01); opacity: 1; }
    100% { transform: translateY(0) scale(1); opacity: 1; }
  }
  .feed-card-updated {
    animation: feed-card-updated 420ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  @keyframes room-page-slide-in {
    0% { transform: translateX(40px); opacity: 0; }
    100% { transform: translateX(0); opacity: 1; }
  }
  .room-page-slide {
    animation: room-page-slide-in 480ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
`
