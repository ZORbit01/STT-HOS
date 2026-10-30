import type { VadMode } from '../types'

interface ModeTogglesProps {
  vadMode: VadMode
  pttHotkey?: string
  onVadModeChange: (vadMode: VadMode) => void
}

export function ModeToggles({ vadMode, pttHotkey, onVadModeChange }: ModeTogglesProps) {
  const isToggleMode = pttHotkey === 'MediaPlayPause'
  const pttLabel = isToggleMode ? 'Tap' : 'Hold'
  const pttHint = isToggleMode
    ? 'Tap pedal to start, tap again to stop.'
    : 'Phase blocks stay active for manual transitions.'

  return (
    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-xs font-black uppercase tracking-widest text-[#0F172A]">Voice input</div>
        <div className="mt-0.5 text-xs font-semibold text-[#64748B]">{pttHint}</div>
      </div>
      <div className="grid w-full grid-cols-2 gap-1 border border-[#D7DEE8] bg-[#F8FAFC] p-1 sm:w-[260px]">
        <button
          type="button"
          onClick={() => onVadModeChange('wake')}
          className={`h-11 rounded-md text-xs font-black uppercase tracking-widest transition-colors ${
            vadMode === 'wake' ? 'bg-[#ECFEFF] text-[#0891B2] shadow-sm ring-1 ring-[#67E8F9]' : 'text-[#64748B] hover:bg-white/70'
          }`}
        >
          Sina
        </button>
        <button
          type="button"
          onClick={() => onVadModeChange('ptt')}
          className={`h-11 rounded-md text-xs font-black uppercase tracking-widest transition-colors ${
            vadMode === 'ptt' ? 'bg-[#0F2044] text-white shadow-sm' : 'text-[#64748B] hover:bg-white/70'
          }`}
        >
          {pttLabel}
        </button>
      </div>
    </div>
  )
}
