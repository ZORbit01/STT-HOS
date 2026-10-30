import { ArrowRightStartOnRectangleIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import type { Case } from '../../../types'
import { PHASE_LABEL } from '../constants'

interface StatusBarProps {
  room: string
  activeCase: Case | undefined
  wsReady: boolean
  nurseName: string
  inductionPhysicianName: string
  onChangeInductionPhysician: () => void
  onEndShift: () => void
}

export function StatusBar({
  room,
  activeCase,
  wsReady,
  nurseName,
  inductionPhysicianName,
  onChangeInductionPhysician,
  onEndShift,
}: StatusBarProps) {
  const displayCode = activeCase ? activeCase.voice_case_code ?? activeCase.case_code : null

  return (
    <>
      <div className="shrink-0 border-b border-[#D7E2EF] bg-white px-4 py-2 sm:hidden">
        <div className="flex h-10 items-center gap-2">
          <span className="flex h-8 shrink-0 items-center justify-center rounded-lg bg-[#0F2044] px-2.5 text-xs font-black text-white">{room}</span>
          <button type="button" onClick={onChangeInductionPhysician} className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1 text-left active:bg-[#F1F5F9]">
          <div className="min-w-0 flex-1">
              <div className="truncate text-[9px] font-black uppercase tracking-wider text-[#94A3B8]">Induction physician</div>
              <div className="truncate text-xs font-bold leading-tight text-[#334155]">{inductionPhysicianName || 'Not selected'}</div>
          </div>
            <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-[#94A3B8]" />
          </button>
          <button type="button" onClick={onEndShift} aria-label="End shift" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#64748B] active:bg-[#FEF2F2] active:text-[#DC2626]">
            <ArrowRightStartOnRectangleIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="hidden shrink-0 items-center justify-between gap-3 border-b border-[#D7E2EF] bg-white px-6 py-3 sm:flex lg:px-10">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="rounded-md bg-[#0F2044] px-2.5 py-1 text-sm font-black text-white">{room}</span>
        {activeCase ? (
          <div className="min-w-0">
            <span className="text-sm font-black text-[#0F172A]">
              {displayCode}
            </span>
            <span className="ml-2 text-xs font-bold uppercase tracking-wide text-[#64748B]">
              {PHASE_LABEL[activeCase.current_phase]}
            </span>
          </div>
        ) : (
          <span className="text-sm text-[#94A3B8]">No active case</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <div className="w-2 h-2 rounded-full" style={{
          backgroundColor: wsReady ? '#16A34A' : '#D97706',
          animation: wsReady ? undefined : 'orb-breathe 1.5s ease-in-out infinite'
        }} />
        <div className="hidden min-w-0 text-right md:block">
          <div className="truncate text-xs font-medium text-[#64748B]">{nurseName}</div>
          <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-[#94A3B8]">Induction: {inductionPhysicianName}</div>
        </div>
        <button
          type="button"
          onClick={onChangeInductionPhysician}
          title="Change induction physician"
          className="h-11 shrink-0 touch-manipulation rounded-md border border-[#CBD5E1] px-4 text-xs font-black uppercase tracking-wide text-[#475569] active:opacity-70"
        >
          Change
        </button>
        <button
          type="button"
          onClick={onEndShift}
          className="h-11 touch-manipulation rounded-md border border-[#CBD5E1] px-4 text-xs font-black uppercase tracking-wide text-[#475569] active:opacity-70"
        >
          End
        </button>
      </div>
      </div>
    </>
  )
}
