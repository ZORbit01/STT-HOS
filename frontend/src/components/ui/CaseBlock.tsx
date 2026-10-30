import type { Case, CasePhase } from '../../types'
import PhaseBadge from './PhaseBadge'
import DelayBadge from './DelayBadge'

const PHASE_BORDER: Record<CasePhase, string> = {
  IDLE:     'border-[#CBD5E1] bg-[#F1F5F9]',
  IN:       'border-[#BFDBFE] bg-[#EFF6FF]',
  INDUCTION: 'border-[#99F6E4] bg-[#F0FDFA]',
  INCISION: 'border-[#FED7AA] bg-[#FFF7ED]',
  CLOSURE:  'border-[#FECDD3] bg-[#FFF1F2]',
  OUT:      'border-[#DDD6FE] bg-[#F5F3FF]',
  CLEANING: 'border-[#BBF7D0] bg-[#F0FDF4]',
  COMPLETE: 'border-[#BBF7D0] bg-[#F0FDF4]',
  CANCELLED: 'border-[#FCA5A5] bg-[#FEF2F2]',
}

interface Props {
  case_: Case
  delayMinutes?: number | null
  showPhaseButtons?: false  // display page never shows buttons
}

export default function CaseBlock({ case_, delayMinutes = null }: Props) {
  const isAlert = case_.alert_level !== 'NONE'
  const displayCode = case_.voice_case_code ?? case_.case_code

  return (
    <div className={`
      relative border rounded-sm p-2 mx-1 my-1
      ${PHASE_BORDER[case_.current_phase]}
      ${isAlert ? 'ring-1 ring-red-400' : ''}
    `}>
      {/* Top row — case code + delay badge */}
      <div className="flex items-start justify-between pr-14">
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-bold text-[#0F172A]">{displayCode}</span>
        </div>
        <PhaseBadge phase={case_.current_phase} />
      </div>

      <DelayBadge minutes={delayMinutes} />

      {/* Procedure */}
      <p className="text-xs text-[#475569] truncate mt-0.5">{case_.procedure_name}</p>

      {/* Doctor */}
      <p className="text-xs text-[#94A3B8]">
        {case_.doctor.first_name} {case_.doctor.last_name}
      </p>

      {/* Scheduled time */}
      <p className="text-xs font-mono text-[#94A3B8] mt-0.5">
        {new Date(case_.scheduled_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        {' · '}{case_.estimated_duration_min} min
      </p>

      {/* Alert dot */}
      {isAlert && (
        <span className="absolute bottom-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
      )}
    </div>
  )
}
