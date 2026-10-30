import type { CasePhase } from '../../types'

interface Props {
  phase: CasePhase
}

const PHASE_STYLES: Record<CasePhase, string> = {
  IDLE:     'bg-[#F1F5F9] text-[#64748B] border-[#CBD5E1]',
  IN:       'bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]',
  INDUCTION: 'bg-[#F0FDFA] text-[#0F766E] border-[#99F6E4]',
  INCISION: 'bg-[#FFF7ED] text-[#C2410C] border-[#FED7AA]',
  CLOSURE:  'bg-[#FFF1F2] text-[#BE123C] border-[#FECDD3]',
  OUT:      'bg-[#F5F3FF] text-[#6D28D9] border-[#DDD6FE]',
  CLEANING: 'bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0]',
  COMPLETE: 'bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0]',
  CANCELLED: 'bg-[#FEF2F2] text-[#DC2626] border-[#FCA5A5]',
}

export default function PhaseBadge({ phase }: Props) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-sm border text-xs font-semibold uppercase tracking-wide ${PHASE_STYLES[phase]}`}>
      {phase}
    </span>
  )
}
