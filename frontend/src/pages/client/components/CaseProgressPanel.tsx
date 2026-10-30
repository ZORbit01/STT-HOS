import type { Case, CasePhase } from '../../../types'
import { PHASE_LABEL, PHASE_STEPS } from '../constants'
import { useEffect, useRef, useState } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'

const ACTIONS: CasePhase[] = [...PHASE_STEPS, 'COMPLETE']
const TRANSITION_HOLD_MS = 1_000

interface CaseProgressPanelProps {
  activeCase: Case | undefined
  nextCase?: Case | undefined
  nextCaseLabel?: string
  embedded?: boolean
  onTransition?: (phase: CasePhase) => void | Promise<void>
  onRequestCancellation?: () => void
}

function formatClock(value: string | null | undefined) {
  if (!value) return '--:--'
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function progressPercent(activeCase: Case | undefined) {
  if (!activeCase) return 0
  const started = activeCase.actual_start_at ? new Date(activeCase.actual_start_at).getTime() : NaN
  const expected = activeCase.expected_end_at ? new Date(activeCase.expected_end_at).getTime() : NaN
  if (!Number.isFinite(started) || !Number.isFinite(expected) || expected <= started) {
    const index = PHASE_STEPS.indexOf(activeCase.current_phase)
    if (activeCase.current_phase === 'COMPLETE') return 100
    return index >= 0 ? Math.round(((index + 1) / PHASE_STEPS.length) * 100) : 0
  }
  return Math.max(0, Math.min(100, Math.round(((Date.now() - started) / (expected - started)) * 100)))
}

function nextPhase(current: CasePhase) {
  if (current === 'COMPLETE') return 'Done'
  const index = PHASE_STEPS.indexOf(current)
  if (index < 0) return PHASE_LABEL.IN
  return PHASE_LABEL[PHASE_STEPS[index + 1] ?? 'COMPLETE']
}

function phaseButtonLabel(phase: CasePhase) {
  return phase === 'COMPLETE' ? 'Complete' : PHASE_LABEL[phase]
}

function PhaseRail({
  currentIndex,
  onTransition,
}: {
  currentIndex: number
  onTransition?: (phase: CasePhase) => void | Promise<void>
}) {
  const [holdingPhase, setHoldingPhase] = useState<CasePhase | null>(null)
  const [submittingPhase, setSubmittingPhase] = useState<CasePhase | null>(null)
  const holdTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(holdTimer.current), [])

  async function submitTransition(phase: CasePhase) {
    setHoldingPhase(null)
    setSubmittingPhase(phase)
    navigator.vibrate?.([35, 40, 35])
    try {
      await Promise.all([
        Promise.resolve(onTransition?.(phase)),
        new Promise((resolve) => window.setTimeout(resolve, 350)),
      ])
    } finally {
      setSubmittingPhase(null)
    }
  }

  function startHold(phase: CasePhase) {
    if (submittingPhase || holdingPhase) return
    setHoldingPhase(phase)
    navigator.vibrate?.(20)
    window.clearTimeout(holdTimer.current)
    holdTimer.current = window.setTimeout(() => void submitTransition(phase), TRANSITION_HOLD_MS)
  }

  function cancelHold(phase: CasePhase) {
    if (holdingPhase !== phase) return
    window.clearTimeout(holdTimer.current)
    setHoldingPhase(null)
  }

  return (
    <div className="mt-4 sm:mt-5">
      <div className="grid grid-cols-7">
        {ACTIONS.map((phase, index) => {
          const complete = currentIndex >= 0 && index < currentIndex
          const active = currentIndex === index
          const next = currentIndex >= 0 ? index === currentIndex + 1 : index === 0
          const clickable = Boolean(onTransition && next)
          const holding = holdingPhase === phase
          const submitting = submittingPhase === phase
          const label = phaseButtonLabel(phase)
          const nodeClass = submitting
            ? 'border-[#15803D] bg-[#15803D] text-white shadow-[0_0_0_5px_rgba(21,128,61,0.16)]'
            : holding
              ? 'border-[#D97706] bg-[#FEF3C7] text-[#92400E] shadow-[0_0_0_5px_rgba(217,119,6,0.18)]'
              : active
            ? 'border-[#0F2044] bg-[#0F2044] text-white'
            : complete
              ? 'border-[#0F2044] bg-[#EEF6FF] text-[#0F2044]'
              : next
                ? 'border-[#0F2044] bg-white text-[#0F2044] shadow-[0_0_0_4px_rgba(15,32,68,0.10)]'
                : 'border-[#CBD5E1] bg-white text-[#94A3B8]'

          return (
            <button
              key={phase}
              type="button"
              aria-disabled={!clickable}
              aria-pressed={holding || submitting}
              disabled={Boolean(submittingPhase)}
              onPointerDown={(event) => {
                if (!clickable) return
                event.preventDefault()
                event.currentTarget.setPointerCapture(event.pointerId)
                startHold(phase)
              }}
              onPointerUp={() => cancelHold(phase)}
              onPointerLeave={() => cancelHold(phase)}
              onPointerCancel={() => cancelHold(phase)}
              onLostPointerCapture={() => cancelHold(phase)}
              onKeyDown={(event) => {
                if (!clickable || event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return
                event.preventDefault()
                startHold(phase)
              }}
              onKeyUp={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                cancelHold(phase)
              }}
              onBlur={() => cancelHold(phase)}
              onContextMenu={(event) => event.preventDefault()}
              className={`relative flex min-h-[128px] min-w-0 touch-manipulation flex-col items-center justify-start px-0.5 text-center outline-none sm:min-h-[148px] sm:px-1 lg:min-h-[168px] ${
                clickable
                  ? 'cursor-pointer touch-none focus-visible:ring-2 focus-visible:ring-[#0F2044] focus-visible:ring-offset-2'
                  : 'cursor-default'
              }`}
            >
              {index > 0 && (
                <span
                  className="absolute left-0 right-1/2 top-7 h-0.5 sm:top-9 lg:top-11"
                  style={{ backgroundColor: complete || active ? '#0F2044' : '#CBD5E1' }}
                />
              )}
              {index < ACTIONS.length - 1 && (
                <span
                  className="absolute left-1/2 right-0 top-7 h-0.5 sm:top-9 lg:top-11"
                  style={{ backgroundColor: complete ? '#0F2044' : '#CBD5E1' }}
                />
              )}
              <span className="relative z-10 aspect-square w-[clamp(3.25rem,13vw,5rem)] max-w-full">
                <span
                  className={`flex h-full w-full items-center justify-center border-2 text-base font-black sm:text-xl lg:text-2xl ${nodeClass}`}
                >
                  {complete ? '✓' : index + 1}
                </span>
                {holding && (
                  <svg aria-hidden="true" className="pointer-events-none absolute -inset-1 h-[calc(100%+0.5rem)] w-[calc(100%+0.5rem)] -rotate-90 overflow-visible" viewBox="0 0 40 40">
                    <rect
                      className="phase-hold-progress"
                      x="1"
                      y="1"
                      width="38"
                      height="38"
                      pathLength="100"
                      fill="none"
                      stroke="#D97706"
                      strokeWidth="2.5"
                    />
                  </svg>
                )}
              </span>
              <span
                className="mt-2 max-w-full truncate text-[9px] font-black uppercase tracking-tight sm:text-xs lg:mt-2.5 lg:text-sm lg:tracking-wide"
                style={{ color: active || next ? '#0F172A' : complete ? '#0369A1' : '#94A3B8' }}
              >
                {label}
              </span>
              {next && (
                <span
                  className={`mt-1 text-[8px] font-black uppercase tracking-wide sm:text-[10px] lg:text-xs lg:tracking-widest ${
                    submitting ? 'text-[#15803D]' : holding ? 'text-[#B45309]' : 'text-[#0F2044]'
                  }`}
                >
                  {submitting ? 'Confirmed' : holding ? 'Keep holding' : 'Hold to confirm'}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function CaseProgressPanel({ activeCase, nextCase, nextCaseLabel, embedded = false, onTransition, onRequestCancellation }: CaseProgressPanelProps) {
  const [now, setNow] = useState(() => Date.now())
  const [confirmingCancelCaseId, setConfirmingCancelCaseId] = useState<string | null>(null)
  const cancelDisarmTimer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!activeCase || activeCase.current_phase === 'COMPLETE') return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [activeCase])
  useEffect(() => () => window.clearTimeout(cancelDisarmTimer.current), [])

  function handleCancellationTap() {
    if (!activeCase) return
    const confirmingCancel = confirmingCancelCaseId === activeCase.id
    if (!confirmingCancel) {
      setConfirmingCancelCaseId(activeCase.id)
      window.clearTimeout(cancelDisarmTimer.current)
      // Auto-disarm so a forgotten confirm state can't fire much later by accident
      cancelDisarmTimer.current = window.setTimeout(() => setConfirmingCancelCaseId(null), 5_000)
      return
    }
    window.clearTimeout(cancelDisarmTimer.current)
    setConfirmingCancelCaseId(null)
    onRequestCancellation?.()
  }

  if (!activeCase) {
    if (!nextCase || !onTransition) return null
    const displayCode = nextCase ? (nextCase.voice_case_code ?? nextCase.case_code) : null
    return (
      <section className={`w-full ${embedded ? '' : 'rounded-lg border border-[#DDE6F2] bg-white p-4 shadow-sm sm:p-5'}`}>
        <div>
          <div className="mb-2 text-[11px] font-black uppercase tracking-widest text-[#94A3B8]">
            {nextCaseLabel ?? 'Next case'} — {displayCode}
          </div>
          <PhaseRail currentIndex={-1} onTransition={(phase) => onTransition(phase)} />
        </div>
      </section>
    )
  }

  const percent = progressPercent(activeCase)
  const confirmingCancel = confirmingCancelCaseId === activeCase.id
  const displayCode = activeCase.voice_case_code ?? activeCase.case_code
  const currentIndex = activeCase.current_phase === 'COMPLETE'
    ? ACTIONS.length - 1
    : PHASE_STEPS.indexOf(activeCase.current_phase)

  const expectedEndMs = activeCase.expected_end_at ? new Date(activeCase.expected_end_at).getTime() : null
  const overrunMs = expectedEndMs && now > expectedEndMs ? now - expectedEndMs : 0
  const isOverrun = overrunMs > 0
  const overrunTotalSec = Math.floor(overrunMs / 1000)
  const overrunMin = Math.floor(overrunTotalSec / 60)
  const overrunSec = overrunTotalSec % 60
  const overrunLabel = `+${overrunMin}:${String(overrunSec).padStart(2, '0')}`
  const endLabel = isOverrun
    ? new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : formatClock(activeCase.expected_end_at)

  return (
    <section className={`w-full ${embedded ? '' : 'rounded-lg border border-[#DDE6F2] bg-white p-4 shadow-sm sm:p-5'}`}>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-widest text-[#94A3B8]">Current case</div>
          <div className="mt-1 flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-2xl font-black leading-none text-[#0F172A]">{displayCode}</span>
            <span className="truncate text-sm font-bold text-[#0077B6]">{PHASE_LABEL[activeCase.current_phase]}</span>
            {activeCase.current_phase !== 'COMPLETE' && activeCase.current_phase !== 'CANCELLED' && (
              activeCase.cancellation_requested ? (
                <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[#FEF2F2] px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-[#B91C1C] lg:hidden">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#DC2626]" />
                  Cancel pending
                </span>
              ) : onRequestCancellation ? (
                <button
                  type="button"
                  aria-label={confirmingCancel ? 'Confirm cancellation request' : 'Request cancellation'}
                  title={confirmingCancel ? 'Tap again to confirm' : 'Request cancellation'}
                  onClick={handleCancellationTap}
                  className={`ml-auto inline-flex h-8 touch-manipulation items-center justify-center rounded-full transition-all lg:hidden ${
                    confirmingCancel
                      ? 'gap-1.5 bg-[#DC2626] px-3 text-[9px] font-black uppercase tracking-wide text-white'
                      : 'w-8 text-[#94A3B8] active:bg-[#FEE2E2] active:text-[#DC2626]'
                  }`}
                >
                  <XMarkIcon className="h-4 w-4 shrink-0" strokeWidth={2.5} />
                  {confirmingCancel && <span>Confirm cancel</span>}
                </button>
              ) : null
            )}
          </div>
          <div className="mt-2 truncate text-sm font-semibold text-[#334155]">{activeCase.procedure_name}</div>
          <div className="mt-1 truncate text-xs font-semibold text-[#64748B]">Dr. {activeCase.doctor.last_name}</div>
        </div>
        <div className="shrink-0 text-right">
          {isOverrun ? (
            <>
              <div className="font-mono text-2xl font-black leading-none text-[#DC2626]">{overrunLabel}</div>
              <div className="mt-0.5 text-[10px] font-black uppercase tracking-widest text-[#DC2626]">overrun</div>
            </>
          ) : (
            <div className="text-xs font-black uppercase tracking-widest text-[#64748B]">
              Next: <span className="text-[#0F172A]">{nextPhase(activeCase.current_phase)}</span>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex justify-between font-mono text-[11px] font-black text-[#94A3B8]">
          <span>{formatClock(activeCase.actual_start_at ?? activeCase.scheduled_start)}</span>
          <span style={{ color: isOverrun ? '#DC2626' : undefined }}>{endLabel}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[#E2E8F0]">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${Math.min(percent, 100)}%`, backgroundColor: isOverrun ? '#DC2626' : '#0077B6' }}
          />
        </div>
      </div>

      <PhaseRail currentIndex={currentIndex} onTransition={onTransition} />

      {activeCase.current_phase !== 'COMPLETE' && activeCase.current_phase !== 'CANCELLED' && (
        <div className="mt-4 hidden border-t border-[#E2E8F0] pt-4 lg:block">
          {activeCase.cancellation_requested ? (
            <div className="rounded-md bg-[#FEF2F2] px-3 py-2 text-center text-xs font-black uppercase tracking-widest text-[#DC2626]">
              Cancellation requested — awaiting admin
            </div>
          ) : onRequestCancellation ? (
            <button
              type="button"
              onClick={handleCancellationTap}
              className={`w-full touch-manipulation rounded-md border px-3 py-3.5 text-sm font-black uppercase tracking-widest ${
                confirmingCancel
                  ? 'border-[#DC2626] bg-[#DC2626] text-white hover:bg-[#B91C1C]'
                  : 'border-[#DC2626] bg-white text-[#DC2626] hover:bg-[#FEF2F2]'
              }`}
            >
              {confirmingCancel ? 'Confirm cancellation request' : 'Request cancellation'}
            </button>
          ) : null}
        </div>
      )}

    </section>
  )
}
