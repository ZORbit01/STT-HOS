import type { Case, Room } from '../../types'
import CaseBlock from './CaseBlock'

interface Props {
  room: Room
  cases: Case[]
}

export default function RoomRow({ room, cases }: Props) {
  const isAlert = cases.some((c) => c.alert_level !== 'NONE')

  return (
    <div className={`
      flex border-b border-[#E2E8F0] min-h-[88px]
      ${isAlert ? 'ring-1 ring-inset ring-red-300 bg-red-50/40' : ''}
    `}>
      {/* Room label */}
      <div className="w-20 shrink-0 px-3 py-2 border-r border-[#E2E8F0] bg-[#F8FAFC] flex flex-col justify-center">
        <span className="text-sm font-bold text-[#0F172A]">{room.room_code}</span>
        <span className="text-xs text-[#94A3B8] mt-0.5">
          {room.status === 'IN_USE' ? 'In Use' : 'Available'}
        </span>
        {isAlert && (
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse mt-1" />
        )}
      </div>

      {/* Cases in this room */}
      <div className="flex-1 flex flex-wrap items-start content-start p-1">
        {cases.length === 0 ? (
          <p className="text-xs text-[#94A3B8] p-2 self-center">No cases scheduled</p>
        ) : (
          cases.map((c) => (
            <div key={c.id} className="w-56">
              <CaseBlock case_={c} />
            </div>
          ))
        )}
      </div>
    </div>
  )
}
