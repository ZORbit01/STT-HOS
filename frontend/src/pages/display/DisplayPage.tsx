import { useEffect, useMemo, useRef, useState } from 'react'
import { getScreenFeed } from '../../api/screen'
import { useScreenState } from '../../hooks/useScreenState'
import type { ScreenCase, ScreenFeedEvent, ScreenRoom } from '../../types'
import { VisitorLiveNewsFeed, VisitorRoomCard, visitorDisplayAnimationStyles } from './components/VisitorDisplayComponents'
import { playPhaseTransition, playPatientOut, playCaseComplete } from '../client/utils/sounds'
import { useVisitorDisplaySettingsStore } from '../../store/useVisitorDisplaySettingsStore'

type DisplayFeedEvent = ScreenFeedEvent & { collapsed_count?: number }

const ROOM_PAGE_ROTATE_MS = 15_000

function compactVisitorFeed(events: ScreenFeedEvent[], startedCaseCodes: Set<string>): DisplayFeedEvent[] {
  const visible: DisplayFeedEvent[] = []
  const latestRescheduleByCase = new Map<string, DisplayFeedEvent>()
  const roomMoveShown = new Set<string>()

  for (const event of events) {
    if (event.kind !== 'reschedule') continue
    if (!event.case_code || !event.room_code) continue
    if (startedCaseCodes.has(event.case_code)) continue

    const isRoomMove = Boolean(event.metadata?.from_room && event.metadata?.to_room)

    if (isRoomMove) {
      // Show at most one room-move event per case (the latest)
      const moveKey = `move:${event.case_code}`
      if (!roomMoveShown.has(moveKey)) {
        roomMoveShown.add(moveKey)
        visible.push({ ...event, collapsed_count: 0 })
      }
      continue
    }

    const key = `${event.room_code}:${event.case_code}`
    const existing = latestRescheduleByCase.get(key)
    if (existing) {
      existing.collapsed_count = (existing.collapsed_count ?? 0) + 1
      continue
    }

    const item: DisplayFeedEvent = { ...event, collapsed_count: 0 }
    latestRescheduleByCase.set(key, item)
    visible.push(item)
  }

  return visible.slice(0, 28)
}

function shouldReplaceFeedEvent(a: ScreenFeedEvent, b: ScreenFeedEvent) {
  if (a.kind !== 'reschedule' || b.kind !== 'reschedule') return false
  if (a.metadata?.from_room || b.metadata?.from_room) return false
  return Boolean(a.room_code && a.case_code && a.room_code === b.room_code && a.case_code === b.case_code)
}

function upsertLiveFeedEvent(items: ScreenFeedEvent[], event: ScreenFeedEvent) {
  if ((event.kind === 'complete' || (event.kind === 'phase' && event.metadata?.phase === 'IN')) && event.case_code) {
    return items.filter((item) => item.case_code !== event.case_code)
  }
  if (event.kind !== 'reschedule') return items

  const isRoomMove = Boolean(event.metadata?.from_room && event.metadata?.to_room)

  if (isRoomMove && event.case_code) {
    // Remove all prior events for this case (old room reschedules + old room-move entries), show only the new move
    const withoutCase = items.filter((item) => item.case_code !== event.case_code)
    return [event, ...withoutCase].slice(0, 60)
  }

  const withoutSameLogicalEvent = items.filter((item) => item.id !== event.id && !shouldReplaceFeedEvent(item, event))
  return [event, ...withoutSameLogicalEvent].slice(0, 60)
}

function DisplayPage() {
  const { state, lastMessage } = useScreenState('visitor')
  const [notifications, setNotifications] = useState<ScreenFeedEvent[]>([])
  const [compactLayout, setCompactLayout] = useState(() => window.matchMedia('(max-width: 639px)').matches)
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set())
  const lastProcessedRef = useRef<string | null>(null)
  const soundAcRef = useRef<AudioContext | null>(null)

  // Lazy shared AudioContext for visitor notification chimes. Browsers gate audio
  // behind a user gesture, so it may start suspended on a kiosk with no interaction;
  // primeDisplaySound() (wired to the first pointer/key event) resumes it.
  function displaySound(): AudioContext | null {
    if (!soundAcRef.current) {
      try { soundAcRef.current = new AudioContext() } catch { return null }
    }
    const ac = soundAcRef.current
    if (ac.state === 'suspended') void ac.resume()
    return ac.state === 'running' ? ac : null
  }

  useEffect(() => {
    function prime() {
      if (!soundAcRef.current) {
        try { soundAcRef.current = new AudioContext() } catch { return }
      }
      if (soundAcRef.current.state === 'suspended') void soundAcRef.current.resume()
    }
    window.addEventListener('pointerdown', prime, { once: true })
    window.addEventListener('keydown', prime, { once: true })
    return () => {
      window.removeEventListener('pointerdown', prime)
      window.removeEventListener('keydown', prime)
    }
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)')
    const sync = () => setCompactLayout(media.matches)
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    let alive = true
    getScreenFeed('visitor')
      .then((res) => {
        if (alive) setNotifications(res.data)
      })
      .catch((error) => console.error('[screen-feed] load failed', error))
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!lastMessage) return
    if (lastMessage.event !== 'screen_feed_event') return
    if (lastMessage.payload.audience !== 'visitor') return

    const fingerprint = JSON.stringify(lastMessage)
    if (fingerprint === lastProcessedRef.current) return
    lastProcessedRef.current = fingerprint

    const notif = lastMessage.payload

    // Play a calm chime matched to the milestone. metadata.phase carries the
    // exact phase ("OUT", "COMPLETE", ...); kind === 'complete' is the finish.
    const phase = typeof notif.metadata?.phase === 'string' ? notif.metadata.phase : null
    if (notif.kind === 'complete' || phase === 'COMPLETE') {
      const ac = displaySound(); if (ac) playCaseComplete(ac)
    } else if (phase === 'OUT') {
      const ac = displaySound(); if (ac) playPatientOut(ac)
    } else if (notif.kind === 'phase') {
      const ac = displaySound(); if (ac) playPhaseTransition(ac)
    }

    setNotifications((items) => upsertLiveFeedEvent(items, notif))
    setFreshIds((items) => new Set([...items, notif.id]))
    window.setTimeout(() => setFreshIds((items) => {
      const next = new Set(items)
      next.delete(notif.id)
      return next
    }), 3000)
  }, [lastMessage])

  const orderedRooms = useMemo(
    () => [...(state?.rooms ?? [])].sort((a, b) => a.room_code.localeCompare(b.room_code, undefined, { numeric: true })),
    [state?.rooms],
  )

  const roomPages = useMemo(() => {
    const roomsPerPage = compactLayout ? 3 : 6
    const pages: ScreenRoom[][] = []
    for (let i = 0; i < orderedRooms.length; i += roomsPerPage) {
      pages.push(orderedRooms.slice(i, i + roomsPerPage))
    }
    return pages.length > 0 ? pages : [[]]
  }, [compactLayout, orderedRooms])

  const [pageIndex, setPageIndex] = useState(0)
  const pageCount = roomPages.length
  const pageLocked = useVisitorDisplaySettingsStore((settings) => settings.pageLocked)

  useEffect(() => {
    if (pageCount <= 1 || pageLocked) return
    const timer = window.setInterval(() => {
      setPageIndex((index) => (index + 1) % pageCount)
    }, ROOM_PAGE_ROTATE_MS)
    return () => window.clearInterval(timer)
  }, [pageCount, pageLocked])

  const currentPage = pageIndex % pageCount
  const visibleRooms = roomPages[currentPage] ?? []

  const casesByRoom = useMemo(() => {
    const map = new Map<string, ScreenCase[]>()
    for (const case_ of state?.cases ?? []) {
      const list = map.get(case_.room_code) ?? []
      list.push(case_)
      map.set(case_.room_code, list)
    }
    return map
  }, [state?.cases])

  const startedCaseCodes = useMemo(() => {
    const codes = new Set<string>()
    for (const case_ of state?.cases ?? []) {
      if (case_.is_active || case_.is_complete) codes.add(case_.case_code)
    }
    return codes
  }, [state?.cases])

  const visibleNotifications = useMemo(
    () => compactVisitorFeed(notifications, startedCaseCodes),
    [startedCaseCodes, notifications],
  )

  return (
    <>
      <style>{visitorDisplayAnimationStyles}</style>
      <div className={`flex h-[calc(100dvh-var(--app-nav-height))] flex-col bg-[#F8FAFC] xl:flex-row ${compactLayout ? 'overflow-y-auto' : 'overflow-hidden'}`}>
        <div className={`relative p-2 sm:min-h-0 sm:flex-1 sm:overflow-hidden sm:p-3 ${compactLayout ? 'flex-none overflow-visible' : 'min-h-0 flex-1 overflow-hidden'}`}>
          {orderedRooms.length === 0 ? (
            <div className="flex h-full items-center justify-center"><span className="text-sm text-gray-300">Connecting to server...</span></div>
          ) : (
            <>
              <div
                key={`${compactLayout}-${currentPage}`}
                className={`room-page-slide grid min-w-0 grid-cols-1 gap-3 sm:h-full sm:grid-cols-2 ${compactLayout ? 'h-auto' : 'h-full'}`}
                style={{ gridTemplateRows: compactLayout ? undefined : 'repeat(3, minmax(0, 1fr))' }}
              >
                {visibleRooms.map((room: ScreenRoom) => {
                  const roomCases = casesByRoom.get(room.room_code) ?? []
                  const activeCase = roomCases.find((case_) => case_.case_code === room.active_case_code)
                  const upcomingCases = roomCases
                    .filter((case_) => !case_.is_active && !case_.is_complete)
                    .sort((a, b) => new Date(a.display_start).getTime() - new Date(b.display_start).getTime())

                  return <VisitorRoomCard key={room.id} room={room} activeCase={activeCase} upcomingCases={upcomingCases} />
                })}
              </div>
            </>
          )}
        </div>
        <VisitorLiveNewsFeed notifications={visibleNotifications} freshIds={freshIds} />
      </div>
    </>
  )
}

export default DisplayPage
