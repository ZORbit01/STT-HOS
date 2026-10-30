import { useEffect, useRef, useState } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import type { Case } from '../../../types'

interface StartCaseSheetProps {
  open: boolean
  room: string
  cases: Case[]
  activeCase: Case | undefined
  onStart: (caseCode: string) => Promise<void>
  onClose: () => void
}

function displayCaseCode(c: Case) {
  return c.voice_case_code ?? c.case_code
}

function formatCaseTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function CaseRow({
  caseItem,
  room,
  crossRoom,
  disabled,
  armed,
  starting,
  onArm,
  onConfirm,
}: {
  caseItem: Case
  room: string
  crossRoom: boolean
  disabled: boolean
  armed: boolean
  starting: boolean
  onArm: () => void
  onConfirm: () => void
}) {
  return (
    <div className="flex items-center gap-4 border-b border-[#E2E8F0] px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-lg font-black text-[#0F172A]">{displayCaseCode(caseItem)}</span>
          {crossRoom && (
            <span className="bg-[#FFF7ED] px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-[#C2410C]">
              {caseItem.scheduled_room_code}
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-sm font-bold text-[#334155]">{caseItem.procedure_name}</div>
        <div className="mt-0.5 truncate text-xs font-semibold text-[#64748B]">
          {formatCaseTime(caseItem.scheduled_start)} · Dr. {caseItem.doctor.last_name}
        </div>
        {armed && crossRoom && (
          <div className="mt-1 text-xs font-black uppercase tracking-wide text-[#C2410C]">
            Scheduled in {caseItem.scheduled_room_code} — will move to {room}
          </div>
        )}
      </div>
      <button
        type="button"
        disabled={disabled || starting}
        onClick={armed ? onConfirm : onArm}
        className={`h-12 w-32 shrink-0 touch-manipulation rounded-sm text-xs font-black uppercase tracking-wide disabled:cursor-not-allowed disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] ${
          armed ? 'bg-[#C2410C] text-white active:opacity-80' : 'bg-[#0F2044] text-white active:opacity-80'
        }`}
      >
        {starting ? 'Starting...' : armed ? 'Confirm start' : `Start in ${room}`}
      </button>
    </div>
  )
}

export function StartCaseSheet({ open, room, cases, activeCase, onStart, onClose }: StartCaseSheetProps) {
  const [armedCode, setArmedCode] = useState<string | null>(null)
  const [startingCode, setStartingCode] = useState<string | null>(null)
  const [error, setError] = useState('')
  const disarmTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!open) {
      setArmedCode(null)
      setStartingCode(null)
      setError('')
    }
    return () => window.clearTimeout(disarmTimer.current)
  }, [open])

  if (!open) return null

  const startable = cases.filter((c) => c.current_phase === 'IDLE' && !c.cancellation_requested)
  const roomQueue = startable.filter((c) => c.scheduled_room_code === room)
  const otherRooms = startable.filter((c) => c.scheduled_room_code !== room)
  const roomBusy = Boolean(activeCase && activeCase.current_phase !== 'COMPLETE' && activeCase.current_phase !== 'CANCELLED')

  function arm(caseCode: string) {
    setError('')
    setArmedCode(caseCode)
    window.clearTimeout(disarmTimer.current)
    // Auto-disarm so a stale confirm button can't be pressed by accident later
    disarmTimer.current = window.setTimeout(() => setArmedCode(null), 5_000)
  }

  async function confirmStart(caseCode: string) {
    window.clearTimeout(disarmTimer.current)
    setStartingCode(caseCode)
    setError('')
    try {
      await onStart(caseCode)
      onClose()
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? `Unable to start ${caseCode} in ${room}.`)
      setArmedCode(null)
    } finally {
      setStartingCode(null)
    }
  }

  function renderRows(list: Case[]) {
    return list.map((c) => (
      <CaseRow
        key={c.id}
        caseItem={c}
        room={room}
        crossRoom={c.scheduled_room_code !== room}
        disabled={roomBusy}
        armed={armedCode === c.case_code}
        starting={startingCode === c.case_code}
        onArm={() => arm(c.case_code)}
        onConfirm={() => confirmStart(c.case_code)}
      />
    ))
  }

  return (
    <div className="fixed inset-0 z-[2000] flex justify-end bg-[#0F172A]/35">
      <button type="button" aria-label="Close" onClick={onClose} className="min-w-0 flex-1" />
      <div className="flex h-full w-full max-w-md flex-col border-l border-[#CBD5E1] bg-white">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[#E2E8F0] px-5 py-4">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-[#94A3B8]">{room}</div>
            <div className="mt-1 text-lg font-black text-[#0F172A]">Start a case in this room</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-sm border border-[#CBD5E1] text-[#475569] active:opacity-70"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {roomBusy && (
          <div className="shrink-0 border-b border-[#FDE68A] bg-[#FFFBEB] px-5 py-3 text-xs font-bold text-[#B45309]">
            {room} already has an active case — complete it before starting another.
          </div>
        )}
        {error && (
          <div className="shrink-0 border-b border-[#FCA5A5] bg-[#FEF2F2] px-5 py-3 text-xs font-bold text-[#B91C1C]">
            {error}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {startable.length === 0 && (
            <div className="px-5 py-10 text-center text-sm font-semibold text-[#64748B]">
              No startable cases right now.
            </div>
          )}
          {roomQueue.length > 0 && (
            <>
              <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-5 py-2 text-[10px] font-black uppercase tracking-widest text-[#94A3B8]">
                Scheduled in {room}
              </div>
              {renderRows(roomQueue)}
            </>
          )}
          {otherRooms.length > 0 && (
            <>
              <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-5 py-2 text-[10px] font-black uppercase tracking-widest text-[#94A3B8]">
                Other rooms
              </div>
              {renderRows(otherRooms)}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
