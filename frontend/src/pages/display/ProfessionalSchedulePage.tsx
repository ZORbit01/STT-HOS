import { Cog6ToothIcon } from '@heroicons/react/24/outline'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { updateCase } from '../../api/cases'
import { useScreenState } from '../../hooks/useScreenState'
import { useAuthStore } from '../../store/useAuthStore'
import { useProfessionalDisplaySettingsStore, type ProfessionalRoomGroup, type ProfessionalViewMode } from '../../store/useProfessionalDisplaySettingsStore'
import type { ScreenCase, ScreenState } from '../../types'
import { ProfessionalScheduleCanvas, type RescheduleProposal, type SwapProposal } from './canvas/ProfessionalScheduleCanvas'
import { ZOOM_LEVELS } from './canvas/professionalCanvasLayout'

function SettingsPanel({
  viewMode,
  zoomIndex,
  showPlannedIndicators,
  followIndicator,
  onViewModeChange,
  onZoomIndexChange,
  onShowPlannedIndicatorsChange,
  onFollowIndicatorChange,
}: {
  viewMode: ProfessionalViewMode
  zoomIndex: number
  showPlannedIndicators: boolean
  followIndicator: boolean
  onViewModeChange: (mode: ProfessionalViewMode) => void
  onZoomIndexChange: (index: number) => void
  onShowPlannedIndicatorsChange: (show: boolean) => void
  onFollowIndicatorChange: (show: boolean) => void
}) {
  return (
    <div className="w-72 border border-[#CBD5E1] bg-white p-3 shadow-[0_14px_30px_rgba(15,23,42,0.16)]">
      <div className="text-[10px] font-black uppercase tracking-widest text-[#475569]">Display</div>
      <div className="mt-2 grid grid-cols-2 border border-[#CBD5E1] bg-[#F8FAFC]">
        {(['AM', 'PM'] as ProfessionalViewMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onViewModeChange(mode)}
            className="h-8 text-[10px] font-black uppercase tracking-wide"
            style={{ backgroundColor: viewMode === mode ? '#0F2044' : 'white', color: viewMode === mode ? 'white' : '#64748B' }}
          >
            {mode}
          </button>
        ))}
      </div>

      <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-2">
        <span className="text-[10px] font-black uppercase tracking-wide text-[#475569]">Planned indicators</span>
        <input
          type="checkbox"
          checked={showPlannedIndicators}
          onChange={(event) => onShowPlannedIndicatorsChange(event.target.checked)}
          className="h-4 w-4 accent-[#0F2044]"
        />
      </label>

      <label className="mt-2 flex cursor-pointer items-center justify-between gap-3 border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-2">
        <span className="text-[10px] font-black uppercase tracking-wide text-[#475569]">Follow indicator</span>
        <input
          type="checkbox"
          checked={followIndicator}
          onChange={(event) => onFollowIndicatorChange(event.target.checked)}
          className="h-4 w-4 accent-[#0F2044]"
        />
      </label>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-[#475569]">Zoom</div>
          <div className="mt-0.5 text-[10px] font-bold text-[#94A3B8]">{ZOOM_LEVELS[zoomIndex]} px/hr</div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => onZoomIndexChange(Math.max(0, zoomIndex - 1))} disabled={zoomIndex === 0} className="h-7 w-7 border border-[#CBD5E1] bg-white text-sm font-black text-[#475569] disabled:text-[#CBD5E1]" title="Zoom out">-</button>
          <button type="button" onClick={() => onZoomIndexChange(Math.min(ZOOM_LEVELS.length - 1, zoomIndex + 1))} disabled={zoomIndex === ZOOM_LEVELS.length - 1} className="h-7 w-7 border border-[#CBD5E1] bg-white text-sm font-black text-[#475569] disabled:text-[#CBD5E1]" title="Zoom in">+</button>
        </div>
      </div>
      <input aria-label="Timeline zoom" type="range" min={0} max={ZOOM_LEVELS.length - 1} step={1} value={zoomIndex} onChange={(event) => onZoomIndexChange(Number(event.target.value))} className="mt-3 h-2 w-full accent-[#0F2044]" />
    </div>
  )
}

const ROOMS_PER_GROUP = 6

function roomCodeIndex(roomCode: string): number {
  const match = roomCode.match(/(\d+)\s*$/)
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY
}

function filterStateByRoomGroup(state: ScreenState | null, roomGroup: ProfessionalRoomGroup): ScreenState | null {
  if (!state) return state
  const isFirstGroup = roomGroup === 'PROF1'
  const rooms = state.rooms.filter((room) => {
    const index = roomCodeIndex(room.room_code)
    return isFirstGroup ? index <= ROOMS_PER_GROUP : index > ROOMS_PER_GROUP
  })
  const roomCodes = new Set(rooms.map((room) => room.room_code))
  return {
    ...state,
    rooms,
    cases: state.cases.filter((case_) => roomCodes.has(case_.room_code)),
    gaps: state.gaps.filter((gap) => roomCodes.has(gap.room_code)),
  }
}

function fmt(value: string | null) {
  if (!value) return '--'
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

function DetailRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3 border-b border-[#F1F5F9] py-2 text-sm">
      <div className="text-[10px] font-black uppercase tracking-widest text-[#94A3B8]">{label}</div>
      <div className="min-w-0 truncate font-semibold text-[#0F172A]">{value ?? '--'}</div>
    </div>
  )
}

function toLocalInputValue(value: string) {
  const date = new Date(value)
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function RescheduleConfirmDialog({
  proposal,
  cases,
  rooms,
  saving,
  error,
  onCancel,
  onConfirm,
}: {
  proposal: RescheduleProposal
  cases: ScreenCase[]
  rooms: string[]
  saving: boolean
  error: string
  onCancel: () => void
  onConfirm: (next: { scheduled_start: string; scheduled_room_code: string }) => void
}) {
  const [start, setStart] = useState(() => toLocalInputValue(proposal.toStart))
  const [room, setRoom] = useState(proposal.toRoomCode)
  const displayCode = proposal.case_.voice_case_code ?? proposal.case_.case_code
  const nextIso = new Date(start).toISOString()
  const deltaMinutes = Math.round((new Date(nextIso).getTime() - new Date(proposal.fromStart).getTime()) / 60_000)
  const durationMs = proposal.case_.estimated_duration_min * 60_000
  const proposedStartMs = new Date(nextIso).getTime()
  const proposedEndMs = proposedStartMs + durationMs
  const targetRoomCases = cases
    .filter((item) => item.id !== proposal.case_.id && item.room_code === room && !item.is_complete)
    .sort((a, b) => new Date(a.display_start).getTime() - new Date(b.display_start).getTime())
  const impactedCases = targetRoomCases.filter((item) => {
    const itemStart = new Date(item.display_start).getTime()
    const itemEnd = new Date(item.visual_end).getTime()
    return proposedStartMs < itemEnd && proposedEndMs > itemStart
  })
  const insertBefore = targetRoomCases.find((item) => new Date(item.display_start).getTime() >= proposedStartMs)
  const impactType = impactedCases.length > 0
    ? proposal.fromRoomCode === room ? 'Cascade' : 'Room move conflict'
    : proposal.fromRoomCode !== room ? 'Room move' : 'Time shift'

  return (
    <div className="fixed inset-0 z-[95000] flex items-center justify-center bg-[#0F172A]/35 px-4">
      <div className="w-[480px] max-w-full border border-[#CBD5E1] bg-white shadow-[0_24px_60px_rgba(15,23,42,0.28)]">
        <div className="border-b border-[#E2E8F0] px-5 py-4">
          <div className="text-[10px] font-black uppercase tracking-widest text-[#64748B]">Confirm reschedule</div>
          <div className="mt-1 text-xl font-black text-[#0F172A]">{displayCode}</div>
          <div className="mt-1 truncate text-sm font-semibold text-[#475569]">{proposal.case_.procedure_label}</div>
        </div>

        <div className="px-5 py-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                  <div className="text-[10px] font-black uppercase tracking-widest text-[#94A3B8]">Current</div>
                  <div className="mt-1 font-mono text-sm font-black text-[#0F172A]">{fmt(proposal.fromStart)}</div>
                  <div className="mt-0.5 text-xs font-black text-[#475569]">{proposal.fromRoomCode}</div>
                </div>
                <div className="border border-[#F59E0B] bg-[#FFFBEB] p-3">
                  <div className="text-[10px] font-black uppercase tracking-widest text-[#B45309]">Proposed</div>
                  <div className="mt-1 font-mono text-sm font-black text-[#0F172A]">{fmt(nextIso)}</div>
                  <div className="mt-0.5 text-xs font-black text-[#475569]">{room} · {deltaMinutes >= 0 ? '+' : ''}{deltaMinutes}m</div>
                </div>
              </div>
              <div className="mt-4 grid gap-3">
                <label className="grid gap-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#64748B]">New start</span>
                  <input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} className="h-10 border border-[#CBD5E1] px-3 font-mono text-sm font-black text-[#0F172A] outline-none focus:border-[#0F2044]" />
                </label>
                <label className="grid gap-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#64748B]">Room</span>
                  <select value={room} onChange={(event) => setRoom(event.target.value)} className="h-10 border border-[#CBD5E1] bg-white px-3 text-sm font-black text-[#0F172A] outline-none focus:border-[#0F2044]">
                    {rooms.map((roomCode) => <option key={roomCode} value={roomCode}>{roomCode}</option>)}
                  </select>
                </label>
              </div>
              <div className="mt-4 border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-[#64748B]">Impact</div>
                    <div className="mt-1 text-sm font-black text-[#0F172A]">{impactType}</div>
                  </div>
                  <div className="text-right text-xs font-black text-[#64748B]">
                    {impactedCases.length > 0 ? `${impactedCases.length} affected` : insertBefore ? `Before ${insertBefore.voice_case_code ?? insertBefore.case_code}` : 'End of room'}
                  </div>
                </div>
                {impactedCases.length > 0 && (
                  <div className="mt-3 grid gap-1">
                    {impactedCases.slice(0, 4).map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-3 border border-[#E2E8F0] bg-white px-2 py-1.5 text-xs">
                        <span className="font-black text-[#0F172A]">{item.voice_case_code ?? item.case_code}</span>
                        <span className="min-w-0 flex-1 truncate font-semibold text-[#475569]">{item.procedure_label}</span>
                        <span className="font-mono font-black text-[#64748B]">{fmt(item.display_start)}</span>
                      </div>
                    ))}
                    {impactedCases.length > 4 && <div className="text-xs font-semibold text-[#64748B]">+{impactedCases.length - 4} more affected case(s)</div>}
                  </div>
                )}
                <div className="mt-2 text-xs font-semibold text-[#64748B]">
                  Saving updates this case. The live schedule will refresh and show any resulting cascade from the schedule engine.
                </div>
              </div>

          {error && <div className="mt-3 border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm font-semibold text-[#B91C1C]">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-[#E2E8F0] px-5 py-3">
          <button type="button" onClick={onCancel} disabled={saving} className="h-9 border border-[#CBD5E1] px-4 text-xs font-black uppercase tracking-wide text-[#475569] disabled:text-[#CBD5E1]">Cancel</button>
          <button type="button" onClick={() => onConfirm({ scheduled_start: nextIso, scheduled_room_code: room })} disabled={saving || !start || !room} className="h-9 bg-[#0F2044] px-4 text-xs font-black uppercase tracking-wide text-white disabled:bg-[#CBD5E1]">{saving ? 'Saving...' : 'Save reschedule'}</button>
        </div>
      </div>
    </div>
  )
}

function CaseDetailsDrawer({
  case_,
  role,
  onClose,
  onControl,
  onRoom,
}: {
  case_: ScreenCase
  role: 'admin' | 'nurse' | null
  onClose: () => void
  onControl: () => void
  onRoom: () => void
}) {
  const displayCode = case_.voice_case_code ?? case_.case_code
  const canNurse = role === 'nurse'

  return (
    <div className="fixed inset-y-0 right-0 z-[90000] w-[420px] max-w-[calc(100vw-1rem)] border-l border-[#CBD5E1] bg-white shadow-[-18px_0_40px_rgba(15,23,42,0.18)]">
      <div className="flex h-full flex-col">
        <div className="border-b border-[#E2E8F0] px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-black uppercase tracking-widest text-[#64748B]">{case_.room_code} · {displayCode}</div>
              <h2 className="mt-1 truncate text-xl font-black text-[#0F172A]">{case_.procedure_label}</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="border border-[#CBD5E1] bg-[#F8FAFC] px-2 py-1 text-[10px] font-black uppercase tracking-wide text-[#475569]">{case_.case_type}</span>
                <span className="border border-[#CBD5E1] bg-white px-2 py-1 text-[10px] font-black uppercase tracking-wide text-[#475569]">{case_.phase_label}</span>
                {case_.overrun_minutes > 0 && <span className="border border-[#FCA5A5] bg-[#FEF2F2] px-2 py-1 text-[10px] font-black uppercase tracking-wide text-[#B91C1C]">+{case_.overrun_minutes}m</span>}
              </div>
            </div>
            <button type="button" onClick={onClose} className="h-8 w-8 shrink-0 border border-[#CBD5E1] text-lg font-black text-[#64748B] hover:bg-[#F8FAFC]" aria-label="Close case details">×</button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {canNurse && (
            <div className="mb-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={onRoom} className="h-9 border border-[#CBD5E1] bg-white px-3 text-xs font-black uppercase tracking-wide text-[#475569] hover:border-[#94A3B8]">Open Room</button>
              <button type="button" onClick={onControl} className="h-9 border border-[#CBD5E1] bg-white px-3 text-xs font-black uppercase tracking-wide text-[#475569] hover:border-[#94A3B8]">Control</button>
            </div>
          )}

          <div className="border-y border-[#E2E8F0]">
            <DetailRow label="Patient" value={case_.patient_label} />
            <DetailRow label="Physician" value={case_.physician_label} />
            <DetailRow label="Phase" value={case_.phase_label} />
            <DetailRow label="Timing" value={case_.status_label} />
            <DetailRow label="Original" value={`${fmt(case_.original_planned_start)}-${fmt(case_.original_planned_end)}`} />
            <DetailRow label="Displayed" value={`${fmt(case_.display_start)}-${fmt(case_.planned_end)}`} />
            <DetailRow label="Actual In" value={fmt(case_.actual_start_at)} />
            <DetailRow label="Actual Out" value={fmt(case_.actual_end_at)} />
            <DetailRow label="Duration" value={`${case_.estimated_duration_min}m`} />
            <DetailRow label="Remaining" value={case_.remaining_minutes === null ? '--' : case_.remaining_minutes >= 0 ? `${case_.remaining_minutes}m` : `+${Math.abs(case_.remaining_minutes)}m`} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ProfessionalSchedulePage() {
  const { state } = useScreenState('professional')
  const [now, setNow] = useState(new Date())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsPosition, setSettingsPosition] = useState<{ left: number; top: number } | null>(null)
  const [selectedCase, setSelectedCase] = useState<ScreenCase | null>(null)
  const [rescheduleProposal, setRescheduleProposal] = useState<RescheduleProposal | null>(null)
  const [rescheduleSaving, setRescheduleSaving] = useState(false)
  const [rescheduleError, setRescheduleError] = useState('')
  const [swapProposal, setSwapProposal] = useState<SwapProposal | null>(null)
  const [swapSaving, setSwapSaving] = useState(false)
  const [swapError, setSwapError] = useState('')
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null)
  const role = useAuthStore((auth) => auth.role)
  const navigate = useNavigate()
  const viewMode = useProfessionalDisplaySettingsStore((settings) => settings.viewMode)
  const roomGroup = useProfessionalDisplaySettingsStore((settings) => settings.roomGroup)
  const zoomIndex = useProfessionalDisplaySettingsStore((settings) => settings.zoomIndex)
  const showPlannedIndicators = useProfessionalDisplaySettingsStore((settings) => settings.showPlannedIndicators)
  const followIndicator = useProfessionalDisplaySettingsStore((settings) => settings.followIndicator)
  const setViewMode = useProfessionalDisplaySettingsStore((settings) => settings.setViewMode)
  const setZoomIndex = useProfessionalDisplaySettingsStore((settings) => settings.setZoomIndex)
  const setShowPlannedIndicators = useProfessionalDisplaySettingsStore((settings) => settings.setShowPlannedIndicators)
  const setFollowIndicator = useProfessionalDisplaySettingsStore((settings) => settings.setFollowIndicator)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const toggleSettings = () => {
    const rect = settingsButtonRef.current?.getBoundingClientRect()
    if (rect) {
      const panelWidth = 288
      const margin = 12
      setSettingsPosition({
        left: Math.max(margin, Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - margin)),
        top: Math.max(margin, Math.min(rect.bottom + 8, window.innerHeight - 260)),
      })
    }
    setSettingsOpen((open) => !open)
  }

  const settingsPanel = settingsOpen && settingsPosition
    ? createPortal(
      <div className="fixed z-[100000]" style={{ left: settingsPosition.left, top: settingsPosition.top }}>
        <SettingsPanel
          viewMode={viewMode}
          zoomIndex={zoomIndex}
          showPlannedIndicators={showPlannedIndicators}
          followIndicator={followIndicator}
          onViewModeChange={setViewMode}
          onZoomIndexChange={setZoomIndex}
          onShowPlannedIndicatorsChange={setShowPlannedIndicators}
          onFollowIndicatorChange={setFollowIndicator}
        />
      </div>,
      document.body,
    )
    : null

  const settingsControl = (
    <button
      ref={settingsButtonRef}
      type="button"
      onClick={toggleSettings}
      className="group flex h-9 w-9 items-center justify-center border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.08)] transition-colors hover:border-[#94A3B8] hover:bg-[#F8FAFC] focus:outline-none focus:ring-2 focus:ring-[#0F2044]/20"
      style={{
        borderColor: settingsOpen ? '#0F2044' : '#CBD5E1',
        color: settingsOpen ? '#0F2044' : '#475569',
        boxShadow: settingsOpen ? 'inset 0 0 0 1px #0F2044, 0 1px 2px rgba(15,23,42,0.08)' : undefined,
      }}
      title="Display settings"
      aria-label="Display settings"
      aria-expanded={settingsOpen}
    >
      <Cog6ToothIcon className="h-[18px] w-[18px] transition-transform group-hover:rotate-45" />
    </button>
  )

  const handleSelectCase = (case_: ScreenCase) => {
    if (role === 'admin') {
      navigate(`/admin?case=${encodeURIComponent(case_.case_code)}`)
      return
    }
    setSelectedCase(case_)
  }

  const roomCodes = [...new Set((state?.rooms ?? []).map((room) => room.room_code))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const groupState = useMemo(() => filterStateByRoomGroup(state, roomGroup), [state, roomGroup])

  const confirmSwap = async () => {
    if (!swapProposal) return
    setSwapSaving(true)
    setSwapError('')
    try {
      await updateCase(swapProposal.caseA.case_code, {
        scheduled_start: swapProposal.caseB.scheduled_start,
        scheduled_room_code: swapProposal.caseB.room_code,
      })
      await updateCase(swapProposal.caseB.case_code, {
        scheduled_start: swapProposal.caseA.scheduled_start,
        scheduled_room_code: swapProposal.caseA.room_code,
      })
      setSwapProposal(null)
    } catch {
      setSwapError('Unable to swap these cases.')
    } finally {
      setSwapSaving(false)
    }
  }

  const confirmReschedule = async (next: { scheduled_start: string; scheduled_room_code: string }) => {
    if (!rescheduleProposal) return
    setRescheduleSaving(true)
    setRescheduleError('')
    try {
      await updateCase(rescheduleProposal.case_.case_code, next)
      setRescheduleProposal(null)
    } catch {
      setRescheduleError('Unable to reschedule this case.')
    } finally {
      setRescheduleSaving(false)
    }
  }

  return (
    <>
      {settingsPanel}
      {rescheduleProposal && (
        <RescheduleConfirmDialog
          proposal={rescheduleProposal}
          cases={state?.cases ?? []}
          rooms={roomCodes}
          saving={rescheduleSaving}
          error={rescheduleError}
          onCancel={() => {
            setRescheduleProposal(null)
            setRescheduleError('')
          }}
          onConfirm={confirmReschedule}
        />
      )}
      {swapProposal && (
        <div className="fixed inset-0 z-[95000] flex items-center justify-center bg-[#0F172A]/35 px-4">
          <div className="w-[440px] max-w-full border border-[#CBD5E1] bg-white shadow-[0_24px_60px_rgba(15,23,42,0.28)]">
            <div className="border-b border-[#E2E8F0] px-5 py-4">
              <div className="text-[10px] font-black uppercase tracking-widest text-[#64748B]">Confirm swap</div>
              <div className="mt-1 text-xl font-black text-[#0F172A]">Exchange two cases</div>
            </div>
            <div className="px-5 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                  <div className="text-[10px] font-black uppercase tracking-widest text-[#94A3B8]">{swapProposal.caseA.voice_case_code ?? swapProposal.caseA.case_code}</div>
                  <div className="mt-1 truncate text-xs font-semibold text-[#475569]">{swapProposal.caseA.procedure_label}</div>
                  <div className="mt-1 font-mono text-sm font-black text-[#0F172A]">{new Date(swapProposal.caseA.scheduled_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</div>
                  <div className="mt-0.5 text-xs font-black text-[#475569]">{swapProposal.caseA.room_code}</div>
                </div>
                <div className="border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                  <div className="text-[10px] font-black uppercase tracking-widest text-[#94A3B8]">{swapProposal.caseB.voice_case_code ?? swapProposal.caseB.case_code}</div>
                  <div className="mt-1 truncate text-xs font-semibold text-[#475569]">{swapProposal.caseB.procedure_label}</div>
                  <div className="mt-1 font-mono text-sm font-black text-[#0F172A]">{new Date(swapProposal.caseB.scheduled_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</div>
                  <div className="mt-0.5 text-xs font-black text-[#475569]">{swapProposal.caseB.room_code}</div>
                </div>
              </div>
              <div className="mt-3 border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-xs font-semibold text-[#64748B]">
                These two cases will exchange their time slots and rooms.
              </div>
              {swapError && <div className="mt-3 border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm font-semibold text-[#B91C1C]">{swapError}</div>}
            </div>
            <div className="flex justify-end gap-2 border-t border-[#E2E8F0] px-5 py-3">
              <button type="button" onClick={() => { setSwapProposal(null); setSwapError('') }} disabled={swapSaving} className="h-9 border border-[#CBD5E1] px-4 text-xs font-black uppercase tracking-wide text-[#475569] disabled:text-[#CBD5E1]">Cancel</button>
              <button type="button" onClick={confirmSwap} disabled={swapSaving} className="h-9 bg-[#6366F1] px-4 text-xs font-black uppercase tracking-wide text-white disabled:bg-[#CBD5E1]">{swapSaving ? 'Swapping...' : 'Confirm swap'}</button>
            </div>
          </div>
        </div>
      )}
      {selectedCase && (
        <CaseDetailsDrawer
          case_={selectedCase}
          role={role}
          onClose={() => setSelectedCase(null)}
          onControl={() => navigate(`/control?case=${encodeURIComponent(selectedCase.case_code)}`)}
          onRoom={() => navigate(`/client/${encodeURIComponent(selectedCase.room_code)}`)}
        />
      )}
      <div className="h-[calc(100dvh-var(--app-nav-height))] overflow-hidden bg-[#EDF1F5] p-2 text-[#0F172A] sm:p-3">
        <ProfessionalScheduleCanvas
          state={groupState}
          now={now}
          viewMode={viewMode}
          zoomIndex={zoomIndex}
          showPlannedIndicators={showPlannedIndicators}
          followIndicator={followIndicator}
          settingsControl={settingsControl}
          onSelectCase={handleSelectCase}
          canDragReschedule={role === 'admin'}
          onZoomIndexChange={setZoomIndex}
          onRescheduleCase={(proposal) => {
            setRescheduleError('')
            setRescheduleProposal(proposal)
          }}
          onSwapCases={(proposal) => {
            setSwapError('')
            setSwapProposal(proposal)
          }}
        />
      </div>
    </>
  )
}
