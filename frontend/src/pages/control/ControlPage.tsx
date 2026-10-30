import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeftIcon, ArrowPathIcon, ArrowRightIcon, ArrowTopRightOnSquareIcon, StopCircleIcon } from '@heroicons/react/24/outline'
import { claimClientRoom, listClientRooms, releaseClientRoom } from '../../api/clientSessions'
import { listCases } from '../../api/cases'
import { listRooms } from '../../api/rooms'
import { useAuthStore } from '../../store/useAuthStore'
import type { Case, ClientRoomOccupancy, Room } from '../../types'
import { PHASE_LABEL, PHASE_STEPS } from '../client/constants'
import { SHIFT_ROOM_KEY } from '../client/shiftRoom'

const ROOMS_PER_PAGE = 6

export default function ControlPage() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [cases, setCases] = useState<Case[]>([])
  const [occupancy, setOccupancy] = useState<ClientRoomOccupancy[]>([])
  const [loading, setLoading] = useState(true)
  const [claiming, setClaiming] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [shiftRoom, setShiftRoom] = useState(() => localStorage.getItem(SHIFT_ROOM_KEY))
  const [pageIndex, setPageIndex] = useState(0)
  const { name, nurseId } = useAuthStore()
  const navigate = useNavigate()

  const orderedRooms = useMemo(
    () => [...rooms].sort((a, b) => a.room_code.localeCompare(b.room_code, undefined, { numeric: true })),
    [rooms],
  )
  const roomPages = useMemo(() => {
    const pages: Room[][] = []
    for (let i = 0; i < orderedRooms.length; i += ROOMS_PER_PAGE) {
      pages.push(orderedRooms.slice(i, i + ROOMS_PER_PAGE))
    }
    return pages.length > 0 ? pages : [[]]
  }, [orderedRooms])
  const currentPage = pageIndex % roomPages.length
  const visibleRooms = roomPages[currentPage] ?? []

  const occupiedByRoom = useMemo(
    () => new Map(occupancy.map((item) => [item.room_code, item])),
    [occupancy],
  )
  const casesByCode = useMemo(
    () => new Map(cases.map((item) => [item.case_code, item])),
    [cases],
  )
  const activeCaseByRoom = useMemo(() => {
    const map = new Map<string, Case>()
    for (const room of rooms) {
      if (!room.active_case_code) continue
      const activeCase = casesByCode.get(room.active_case_code)
      if (activeCase) map.set(room.room_code, activeCase)
    }
    return map
  }, [casesByCode, rooms])
  const shiftActiveCase = shiftRoom ? activeCaseByRoom.get(shiftRoom) : undefined
  const shiftActiveCaseCode = shiftActiveCase ? shiftActiveCase.voice_case_code ?? shiftActiveCase.case_code : null
  const activeRoomCount = rooms.filter((room) => room.status === 'IN_USE' || activeCaseByRoom.has(room.room_code)).length
  const micClientCount = occupancy.filter((item) => item.occupied).length

  async function load() {
    setError('')
    try {
      const [roomsRes, clientRoomsRes, casesRes] = await Promise.all([listRooms(), listClientRooms(), listCases()])
      setRooms(roomsRes.data)
      setOccupancy(clientRoomsRes.data)
      setCases(casesRes.data)
    } catch {
      setError('Unable to load OR rooms.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const id = window.setInterval(load, 10_000)
    return () => window.clearInterval(id)
  }, [])

  async function enterRoom(roomCode: string, knownSessionId?: string | null) {
    setClaiming(roomCode)
    setError('')
    try {
      const savedSessionId = sessionStorage.getItem(`client-session:${roomCode}`)
      const savedShiftRoom = localStorage.getItem(SHIFT_ROOM_KEY)
      if (!savedSessionId && !knownSessionId && savedShiftRoom !== roomCode) {
        navigate(`/client/${roomCode}`)
        return
      }
      const savedPhysicianId = sessionStorage.getItem(`client-physician:${roomCode}`)
      const res = await claimClientRoom(roomCode, savedSessionId ?? knownSessionId, savedPhysicianId)
      localStorage.setItem(SHIFT_ROOM_KEY, roomCode)
      setShiftRoom(roomCode)
      sessionStorage.setItem(`client-session:${roomCode}`, res.data.session_id)
      sessionStorage.setItem(`client-physician:${roomCode}`, res.data.induction_physician_id)
      navigate(`/client/${roomCode}`)
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? `${roomCode} is already in use.`)
      await load()
    } finally {
      setClaiming(null)
    }
  }

  async function endShift() {
    if (shiftRoom) {
      const sessionId = sessionStorage.getItem(`client-session:${shiftRoom}`)
      try {
        await releaseClientRoom(shiftRoom, sessionId)
        sessionStorage.removeItem(`client-session:${shiftRoom}`)
        sessionStorage.removeItem(`client-physician:${shiftRoom}`)
      } catch {}
    }
    localStorage.removeItem(SHIFT_ROOM_KEY)
    setShiftRoom(null)
    await load()
  }

  function goToPage(delta: number) {
    setPageIndex((index) => (index + delta + roomPages.length) % roomPages.length)
  }

  return (
    <div className="flex h-[calc(100dvh-var(--app-nav-height))] flex-col overflow-hidden bg-[#F1F5F9] select-none">
      <div className="mx-auto flex h-full w-full max-w-[110rem] min-h-0 flex-col gap-3 px-4 py-3 lg:px-6">

        {/* ── Header row ─────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="hidden text-[11px] font-semibold uppercase tracking-widest text-[#94A3B8] sm:block">Mic client</p>
            <h1 className="truncate text-lg font-bold tracking-tight text-[#0F172A] sm:text-2xl">Choose your operating room</h1>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden items-center gap-3 rounded-sm border border-[#E2E8F0] bg-white px-4 py-2.5 text-sm text-[#64748B] md:flex">
              <span><b className="text-[#0F172A]">{activeRoomCount}</b> active cases</span>
              <span className="h-5 w-px bg-[#E2E8F0]" />
              <span><b className="text-[#0F172A]">{micClientCount}</b> mic clients</span>
            </div>
            <button
              type="button"
              onClick={load}
              aria-label="Refresh"
              className="flex h-9 w-9 shrink-0 touch-manipulation items-center justify-center gap-2 rounded-sm border border-[#E2E8F0] bg-white text-xs font-semibold uppercase tracking-wide text-[#475569] active:opacity-70 sm:h-12 sm:w-auto sm:px-5 sm:text-sm"
            >
              <ArrowPathIcon className="h-5 w-5" />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="shrink-0 rounded-sm border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-base font-medium text-[#B91C1C]">
            {error}
          </div>
        )}

        {/* ── Current shift banner ───────────────────────────────── */}
        {shiftRoom && (
          <div className="shrink-0 rounded-sm border border-[#D7DEE8] bg-white px-4 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 items-center gap-4">
                <div className="flex h-14 w-20 shrink-0 items-center justify-center rounded-sm bg-[#0F2044] text-2xl font-black text-white">
                  {shiftRoom}
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-[#94A3B8]">Current shift room</p>
                  <p className="mt-0.5 truncate text-base text-[#475569]">
                    {name ? `${name} is assigned here` : 'Assigned room'}
                  </p>
                  {occupiedByRoom.get(shiftRoom)?.session?.induction_physician_name && (
                    <p className="mt-0.5 truncate text-sm text-[#94A3B8]">
                      Induction: {occupiedByRoom.get(shiftRoom)?.session?.induction_physician_name}
                    </p>
                  )}
                </div>
                {shiftActiveCase && (
                  <div className="hidden min-w-0 border-l border-[#E2E8F0] pl-4 xl:block">
                    <div className="flex items-center gap-2">
                      <span className="rounded-sm bg-[#EFF6FF] px-2 py-1 text-xs font-bold uppercase tracking-wide text-[#1D4ED8]">
                        {PHASE_LABEL[shiftActiveCase.current_phase]}
                      </span>
                      <span className="truncate text-base font-bold text-[#0F172A]">
                        {shiftActiveCaseCode} · Dr. {shiftActiveCase.doctor.last_name}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-sm text-[#64748B]">{shiftActiveCase.procedure_name}</div>
                  </div>
                )}
              </div>
              <div className="flex w-full shrink-0 gap-2 lg:w-auto lg:gap-3">
                <button
                  type="button"
                  onClick={() => enterRoom(shiftRoom)}
                  className="flex h-12 flex-1 touch-manipulation items-center justify-center gap-2 rounded-sm bg-[#0F2044] px-3 text-xs font-semibold uppercase tracking-wide text-white active:opacity-80 sm:h-14 sm:px-6 sm:text-base lg:flex-none"
                >
                  <ArrowTopRightOnSquareIcon className="h-5 w-5" />
                  Open mic client
                </button>
                <button
                  type="button"
                  onClick={endShift}
                  className="flex h-12 flex-1 touch-manipulation items-center justify-center gap-2 rounded-sm border-2 border-[#CBD5E1] px-3 text-xs font-semibold uppercase tracking-wide text-[#475569] active:opacity-70 sm:h-14 sm:px-6 sm:text-base lg:flex-none"
                >
                  <StopCircleIcon className="h-5 w-5" />
                  End shift
                </button>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex flex-1 items-center justify-center rounded-sm border border-[#E2E8F0] bg-white text-lg text-[#64748B]">
            Loading rooms...
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">

            {/* ── Room tile grid ─────────────────────────────────── */}
            <div className="grid min-h-0 flex-1 auto-rows-min content-start grid-cols-2 gap-2 overflow-y-auto sm:gap-3 lg:grid-cols-3 lg:gap-4">
              {visibleRooms.map((room) => {
                const roomOccupancy = occupiedByRoom.get(room.room_code)
                const occupied = Boolean(roomOccupancy?.occupied)
                const occupiedByMe = occupied && roomOccupancy?.session?.nurse_id === nurseId
                const blocked = occupied && !occupiedByMe
                const activeCase = activeCaseByRoom.get(room.room_code)
                const phaseLabel = activeCase ? PHASE_LABEL[activeCase.current_phase] : 'Idle'
                const roomInUse = room.status === 'IN_USE' || Boolean(activeCase)
                const phaseIndex = activeCase ? PHASE_STEPS.indexOf(activeCase.current_phase) : -1
                const isClaiming = claiming === room.room_code
                return (
                  <button
                    key={room.id}
                    type="button"
                    disabled={blocked || isClaiming}
                    onClick={() => enterRoom(room.room_code, roomOccupancy?.session?.session_id)}
                    className={`flex min-h-[8.5rem] touch-manipulation flex-col rounded-sm border-2 p-3 text-left sm:min-h-[11rem] sm:p-4 lg:p-5 ${
                      blocked
                        ? 'cursor-not-allowed border-[#E2E8F0] bg-[#F8FAFC] opacity-70'
                        : occupiedByMe
                          ? 'border-[#16A34A] bg-white active:opacity-80'
                          : 'border-[#E2E8F0] bg-white active:opacity-80'
                    }`}
                  >
                    {/* Room code + phase pill */}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-2xl font-black tracking-tight text-[#0F172A] sm:text-3xl lg:text-4xl">{room.room_code}</div>
                        <div className={`mt-1 text-xs font-semibold uppercase tracking-widest ${roomInUse ? 'text-[#1D4ED8]' : 'text-[#16A34A]'}`}>
                          {roomInUse ? 'Case active' : 'Room idle'}
                        </div>
                      </div>
                      <span className={`rounded-sm px-3 py-1.5 text-sm font-bold uppercase tracking-wide ${roomInUse ? 'bg-[#EFF6FF] text-[#1D4ED8]' : 'bg-[#F0FDF4] text-[#16A34A]'}`}>
                        {phaseLabel}
                      </span>
                    </div>

                    {/* Phase progress */}
                    <div className="mt-2 flex gap-1 sm:mt-3">
                      {PHASE_STEPS.map((phase, index) => (
                        <div
                          key={phase}
                          className={`h-2 flex-1 ${phaseIndex >= index ? 'bg-[#1D4ED8]' : 'bg-[#E2E8F0]'}`}
                        />
                      ))}
                    </div>

                    {/* Case details / occupancy */}
                    <div className="mt-2 min-h-0 flex-1 sm:mt-3">
                      {activeCase ? (
                        <>
                          <div className="truncate text-base font-bold text-[#0F172A]">
                            {activeCase.voice_case_code ?? activeCase.case_code}
                            <span className="font-medium text-[#64748B]"> · Dr. {activeCase.doctor.last_name}</span>
                          </div>
                          <div className="mt-0.5 truncate text-sm text-[#64748B]">{activeCase.procedure_name}</div>
                        </>
                      ) : null}
                      <div className={`mt-1 truncate text-sm font-medium ${blocked ? 'text-[#DC2626]' : occupiedByMe ? 'text-[#16A34A]' : 'text-[#94A3B8]'}`}>
                        {occupiedByMe
                          ? 'Your mic client'
                          : occupied
                            ? `In use · ${roomOccupancy?.session?.nurse_name ?? 'another nurse'}`
                            : 'Available'}
                      </div>
                    </div>

                    {/* CTA bar (visual — whole tile is the button) */}
                    <div
                      className={`mt-2 flex h-10 items-center justify-center rounded-sm text-sm font-bold uppercase tracking-wider sm:mt-3 sm:h-12 lg:h-14 lg:text-base ${
                        blocked
                          ? 'bg-[#E2E8F0] text-[#94A3B8]'
                          : occupiedByMe
                            ? 'bg-[#16A34A] text-white'
                            : 'bg-[#0F2044] text-white'
                      }`}
                    >
                      {isClaiming ? 'Opening...' : blocked ? 'Occupied' : occupiedByMe ? 'Resume room' : 'Enter room'}
                    </div>
                  </button>
                )
              })}
            </div>

            {/* ── Pager ──────────────────────────────────────────── */}
            {roomPages.length > 1 && (
              <div className="flex shrink-0 items-center justify-center gap-2 pb-1">
                <button
                  type="button"
                  onClick={() => goToPage(-1)}
                  className="flex h-9 w-9 shrink-0 touch-manipulation items-center justify-center rounded-sm border border-[#E2E8F0] bg-white text-[#475569] active:opacity-70"
                  aria-label="Previous rooms"
                >
                  <ArrowLeftIcon className="h-4 w-4" />
                </button>
                <div className="flex items-center gap-1.5">
                  {roomPages.map((page, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => setPageIndex(index)}
                      aria-label={`Show rooms page ${index + 1}`}
                      className={`flex h-9 touch-manipulation items-center justify-center whitespace-nowrap rounded-sm border px-3 text-xs font-semibold ${
                        index === currentPage
                          ? 'border-[#0F2044] bg-[#0F2044] text-white'
                          : 'border-[#E2E8F0] bg-white text-[#64748B] active:bg-[#F1F5F9]'
                      }`}
                    >
                      {page.length > 0 ? `${page[0].room_code}–${page[page.length - 1].room_code}` : `Page ${index + 1}`}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => goToPage(1)}
                  className="flex h-9 w-9 shrink-0 touch-manipulation items-center justify-center rounded-sm border border-[#E2E8F0] bg-white text-[#475569] active:opacity-70"
                  aria-label="Next rooms"
                >
                  <ArrowRightIcon className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
