import type { PositionedCase } from '../../utils/timeline'
import { timeToFraction, formatTime } from '../../utils/timeline'

const PHASE_COLORS = {
  IDLE:     { bg: '#F8FAFC', text: '#64748B', border: '#E2E8F0', accent: '#CBD5E1' },
  IN:       { bg: '#EFF6FF', text: '#1D4ED8', border: '#BFDBFE', accent: '#3B82F6' },
  INDUCTION: { bg: '#F0FDFA', text: '#0F766E', border: '#99F6E4', accent: '#14B8A6' },
  INCISION: { bg: '#FFF7ED', text: '#C2410C', border: '#FED7AA', accent: '#F97316' },
  CLOSURE:  { bg: '#FFF1F2', text: '#BE123C', border: '#FECDD3', accent: '#F43F5E' },
  OUT:      { bg: '#F5F3FF', text: '#6D28D9', border: '#DDD6FE', accent: '#8B5CF6' },
  CLEANING: { bg: '#F0FDF4', text: '#15803D', border: '#BBF7D0', accent: '#22C55E' },
  COMPLETE: { bg: '#F0FDF4', text: '#15803D', border: '#BBF7D0', accent: '#22C55E' },
  CANCELLED: { bg: '#FEF2F2', text: '#DC2626', border: '#FCA5A5', accent: '#DC2626' },
}

const PHASE_LABEL: Record<string, string> = {
  IDLE:     'Scheduled',
  IN:       'In Room',
  INDUCTION: 'Induction',
  INCISION: 'Incision',
  CLOSURE:  'Closure',
  OUT:      'Out',
  CLEANING: 'Cleaning',
  COMPLETE: 'Complete',
  CANCELLED: 'Cancelled',
}

interface Props {
  positioned: PositionedCase
  containerWidth: number
}

export default function TimelineBlock({ positioned, containerWidth }: Props) {
  const { case_, displayStart, displayEnd, scheduledStart, overrunMin, isActive } = positioned
  const colors = PHASE_COLORS[case_.current_phase]
  const displayCode = case_.voice_case_code ?? case_.case_code

  const leftPx = timeToFraction(displayStart) * containerWidth
  const widthPx = Math.max(80, (timeToFraction(displayEnd) - timeToFraction(displayStart)) * containerWidth)

  const isAlert = case_.alert_level !== 'NONE'
  const isDelayed = overrunMin > 0

  // Progress through case (0–100)
  const now = Date.now()
  const elapsed = now - displayStart.getTime()
  const total = displayEnd.getTime() - displayStart.getTime()
  const progress = isActive ? Math.min(100, Math.max(0, Math.round((elapsed / total) * 100))) : 0

  // Remaining minutes
  const remainingMin = isActive && !isDelayed
    ? Math.max(0, Math.round((displayEnd.getTime() - now) / 60_000))
    : null

  return (
    <div className="absolute inset-y-0" style={{ left: leftPx, width: widthPx }}>
      {/* Ghost block for delayed cases */}
      {isDelayed && (
        <div
          className="absolute inset-y-0 border border-dashed border-[#CBD5E1] opacity-30"
          style={{
            left: -(timeToFraction(displayStart) - timeToFraction(scheduledStart)) * containerWidth,
            width: widthPx,
          }}
        />
      )}

      {/* Main block */}
      <div
        className={`absolute inset-0 border overflow-hidden flex ${isAlert ? 'ring-1 ring-inset ring-red-400' : ''}`}
        style={{ backgroundColor: colors.bg, borderColor: colors.border }}
      >
        {/* Left accent bar */}
        <div className="w-1 shrink-0" style={{ backgroundColor: colors.accent }} />

        {/* Content */}
        <div className="flex flex-col justify-between flex-1 min-w-0 px-2 py-1.5">

          {/* Row 1: code + phase label */}
          <div className="flex items-center justify-between gap-1 min-w-0">
            <span className="text-sm font-black text-[#0F172A] leading-none truncate">{displayCode}</span>
            <span
              className="shrink-0 text-[10px] font-black uppercase tracking-wide leading-none"
              style={{ color: colors.accent }}
            >
              {PHASE_LABEL[case_.current_phase]}
            </span>
          </div>

          {/* Row 2: progress bar */}
          {isActive && (
            <div className="h-1 w-full bg-white/60 overflow-hidden">
              <div
                className="h-full transition-all duration-1000"
                style={{ width: `${progress}%`, backgroundColor: colors.accent }}
              />
            </div>
          )}

          {/* Row 3: doctor · procedure */}
          <p className="text-[10px] font-semibold text-[#94A3B8] truncate leading-none">
            Dr. {case_.doctor.last_name} · {case_.procedure_name}
          </p>

          {/* Row 4: time range + remaining/overrun */}
          <div className="flex items-end justify-between gap-1 min-w-0">
            <span className="font-mono text-[11px] font-black text-[#374151] leading-none truncate">
              {formatTime(displayStart)} – {formatTime(displayEnd)}
            </span>
            {isDelayed ? (
              <span className={`shrink-0 text-sm font-black leading-none ${overrunMin >= 15 ? 'text-[#DC2626]' : 'text-[#D97706]'}`}>
                +{overrunMin}m
              </span>
            ) : remainingMin !== null ? (
              <span className="shrink-0 text-sm font-black leading-none" style={{ color: colors.accent }}>
                {remainingMin}m
              </span>
            ) : null}
          </div>

        </div>
      </div>
    </div>
  )
}
