import { useRef, useEffect, useState } from 'react'
import type { Case, Room } from '../../types'
import { positionCases } from '../../utils/timeline'
import TimelineBlock from './TimelineBlock'

interface Props {
  room: Room
  cases: Case[]
}

export default function TimelineRoomRow({ room, cases }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const isAlert = cases.some((c) => c.alert_level !== 'NONE')

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const positioned = positionCases(cases)

  return (
    <div className={`
      flex border-b border-[#E2E8F0] h-[calc((100dvh-120px)/6)]
      ${isAlert ? 'ring-1 ring-inset ring-red-300 bg-red-50/40' : ''}
    `}>
      {/* Room label */}
      <div className="w-16 shrink-0 border-r border-[#E2E8F0] bg-[#F8FAFC] flex flex-col items-center justify-center gap-1">
        <span className="text-sm font-bold text-[#0F172A]">{room.room_code}</span>
        <span className={`text-[10px] font-semibold uppercase tracking-wide ${
          room.status === 'IN_USE' ? 'text-[#1D4ED8]' : 'text-[#94A3B8]'
        }`}>
          {room.status === 'IN_USE' ? 'In Use' : 'Free'}
        </span>
        {isAlert && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
      </div>

      {/* Timeline area */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        {cases.length === 0 ? (
          <div className="absolute inset-0 flex items-center px-4">
            <span className="text-xs text-[#E2E8F0]">—</span>
          </div>
        ) : (
          positioned.map((p) => (
            <TimelineBlock
              key={p.case_.id}
              positioned={p}
              containerWidth={width}
            />
          ))
        )}
      </div>
    </div>
  )
}
