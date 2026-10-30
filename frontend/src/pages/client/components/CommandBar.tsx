import type { LastCommand } from '../types'

interface CommandBarProps {
  lastCmd: LastCommand | null
}

export function CommandBar({ lastCmd }: CommandBarProps) {
  return (
    <div className="shrink-0 flex min-h-[76px] flex-col justify-center border-t border-[#D7E2EF] bg-white px-4 py-3 sm:px-6 lg:px-10">
      {lastCmd ? (
        <>
          <div className="flex items-center justify-between">
            <span className="truncate text-sm font-bold text-[#0F172A]">{lastCmd.text}</span>
            <span className="ml-4 shrink-0 text-xs font-mono text-[#64748B]">{lastCmd.time}</span>
          </div>
          <div className="mt-2 overflow-hidden rounded-full bg-[#E2E8F0]" style={{ height: 3 }}>
            <div className="h-full rounded-full" style={{
              width: `${Math.round(lastCmd.confidence * 100)}%`,
              backgroundColor: '#06B6D4', transition: 'width 0.4s ease',
            }} />
          </div>
        </>
      ) : (
        <span className="text-xs font-medium uppercase tracking-wide text-[#94A3B8]">No commands yet this shift</span>
      )}
    </div>
  )
}
