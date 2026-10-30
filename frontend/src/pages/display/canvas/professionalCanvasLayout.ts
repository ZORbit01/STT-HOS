import type { CasePhase, ScreenCase, ScreenGap, ScreenRoom, ScreenTimingStatus } from '../../../types'

export type ProfessionalViewMode = 'AM' | 'PM'

export type TimeRange = {
  startHour: number
  endHour: number
}

export type CanvasDensity = 'compact' | 'standard' | 'expanded' | 'deep'

export type CanvasLayoutInput = {
  rooms: ScreenRoom[]
  cases: ScreenCase[]
  gaps: ScreenGap[]
  now: Date
  viewMode: ProfessionalViewMode
  pixelsPerHour: number
  viewportWidth: number
  viewportHeight: number
}

export type CanvasCaseLayout = {
  case_: ScreenCase
  displayStart: Date
  plannedEnd: Date
  x: number
  y: number
  width: number
  plannedWidth: number
  overrunWidth: number
  visualOverrunMinutes: number
  originalPlanX: number
  originalPlanWidth: number
  rowIndex: number
  continuesFromPreviousView: boolean
  continuesIntoNextView: boolean
}

export type CanvasGapLayout = {
  gap: ScreenGap
  x: number
  y: number
  width: number
  rowIndex: number
}

export type CanvasRoomLayout = {
  room: ScreenRoom
  y: number
  rowIndex: number
}

export type ProfessionalCanvasLayout = {
  range: TimeRange
  density: CanvasDensity
  width: number
  height: number
  timelineX: number
  headerHeight: number
  roomLabelWidth: number
  rowHeight: number
  timelineWidth: number
  rooms: CanvasRoomLayout[]
  cases: CanvasCaseLayout[]
  gaps: CanvasGapLayout[]
  currentTimeX: number | null
}

export type DragMoveType = 'free' | 'swap' | 'cascade' | 'room-move' | 'room-move-conflict' | 'past'

export type DragShiftedCase = {
  caseId: string
  originalX: number
  ghostX: number
  ghostY: number
  ghostWidth: number
}

export type DragVisual = {
  sourceCaseId: string
  ghostX: number
  ghostY: number
  ghostWidth: number
  ghostHeight: number
  targetRowY: number
  targetRowHeight: number
  moveType: DragMoveType
  shiftedCases: DragShiftedCase[]
  deltaMinutes: number
  toRoomCode: string
}

export const PHASE_SEQUENCE: CasePhase[] = ['IN', 'INDUCTION', 'INCISION', 'CLOSURE', 'OUT', 'CLEANING']

export const PHASE_LABEL: Record<CasePhase, string> = {
  IDLE: 'Scheduled',
  IN: 'In room',
  INDUCTION: 'Induction',
  INCISION: 'Incision',
  CLOSURE: 'Closing',
  OUT: 'Out',
  CLEANING: 'Cleaning',
  COMPLETE: 'Complete',
  CANCELLED: 'Cancelled',
}

export const TIMING_LABEL: Record<ScreenTimingStatus, string> = {
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'On time',
  NEAR_END: 'Near end',
  OVERRUN: 'Overrun',
  CRITICAL_OVERRUN: 'Critical',
  COMPLETE: 'Complete',
  IDLE: 'Idle',
}

// PM extends 2h past midnight so cases that overrun late at night
// (e.g. 23:30 start, finishing 01:30) render their full span instead
// of being cut off at a day boundary with no later view to continue into.
export const VIEW_RANGE: Record<ProfessionalViewMode, TimeRange> = {
  AM: { startHour: 0, endHour: 12 },
  PM: { startHour: 12, endHour: 26 },
}

export const ZOOM_LEVELS = [200, 240, 300, 380, 480, 620, 800, 1040, 1360, 1800, 2400, 3200, 4400, 6000, 7200, 9600, 12000, 16000, 22000, 28800]

export const ROOM_LABEL_WIDTH = 132
export const HEADER_HEIGHT = 86
export const MIN_TIMELINE_WIDTH = 2400

function dateOf(value: string) {
  return new Date(value)
}

export function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

// All range math is anchored to a single reference day (typically `now`,
// the day the dashboard is showing) rather than each timestamp's own
// implicit calendar day. PM's window extends to 02:00 the next day, so a
// case ending at 01:30 must be measured against "today 12:00 -> tomorrow
// 02:00", not against its own day's 12:00 -> tomorrow's 12:00 boundary
// (which would put it outside the window and collapse its width to ~0).
export function overlapsRange(reference: Date, start: Date, end: Date, range: TimeRange) {
  const startOfView = new Date(reference)
  startOfView.setHours(range.startHour, 0, 0, 0)
  const endOfView = new Date(reference)
  endOfView.setHours(range.endHour, 0, 0, 0)
  return end > startOfView && start < endOfView
}

export function timeToRangeFraction(reference: Date, date: Date, range: TimeRange): number {
  const startOfView = new Date(reference)
  startOfView.setHours(range.startHour, 0, 0, 0)
  const totalMs = (range.endHour - range.startHour) * 3600_000
  const elapsed = date.getTime() - startOfView.getTime()
  return Math.max(0, Math.min(1, elapsed / totalMs))
}

function getLeftWidth(reference: Date, start: Date, end: Date, range: TimeRange, timelineWidth: number, minWidth = 32) {
  const left = timeToRangeFraction(reference, start, range) * timelineWidth
  const width = Math.max(minWidth, (timeToRangeFraction(reference, end, range) - timeToRangeFraction(reference, start, range)) * timelineWidth)
  return { left, width }
}

function rangeBounds(reference: Date, range: TimeRange) {
  const start = new Date(reference)
  start.setHours(range.startHour, 0, 0, 0)
  const end = new Date(reference)
  end.setHours(range.endHour, 0, 0, 0)
  return { start, end }
}

function densityFor(pixelsPerHour: number): CanvasDensity {
  if (pixelsPerHour >= 1800) return 'deep'
  if (pixelsPerHour >= 900) return 'expanded'
  if (pixelsPerHour >= 420) return 'standard'
  return 'compact'
}

function rowHeightFor(roomCount: number, viewportHeight: number, pixelsPerHour: number) {
  // At low zoom the row height is driven by available screen space divided by room count.
  // At high zoom, horizontal scale grows freely but rows stay capped so every OR remains visible.
  const zoomBonus = pixelsPerHour >= 9600 ? 96
    : pixelsPerHour >= 3200 ? 72
    : pixelsPerHour >= 1360 ? 48
    : pixelsPerHour >= 480 ? 24
    : 0
  const available = Math.max(360, viewportHeight - HEADER_HEIGHT)
  if (roomCount <= 0) return 96

  const fitHeight = Math.floor(available / roomCount)
  const base = roomCount <= 8 ? Math.max(92, fitHeight) : 96
  return Math.min(base + zoomBonus, Math.max(56, fitHeight))
}

function layoutCases(cases: ScreenCase[], range: TimeRange, timelineWidth: number, now: Date, roomIndexByCode: Map<string, number>, rowHeight: number): CanvasCaseLayout[] {
  const byRoom = new Map<string, ScreenCase[]>()
  for (const case_ of cases) {
    const list = byRoom.get(case_.room_code) ?? []
    list.push(case_)
    byRoom.set(case_.room_code, list)
  }

  const layouts: CanvasCaseLayout[] = []
  for (const [roomCode, roomCases] of byRoom) {
    const rowIndex = roomIndexByCode.get(roomCode)
    if (rowIndex === undefined) continue
    const y = HEADER_HEIGHT + rowIndex * rowHeight
    const floorItems: Array<{ visualEnd: Date }> = []

    for (const case_ of [...roomCases].sort((a, b) => dateOf(a.display_start).getTime() - dateOf(b.display_start).getTime())) {
      const backendDisplayStart = dateOf(case_.display_start)
      const previousFloor = floorItems.reduce((floor, item) => Math.max(floor, item.visualEnd.getTime()), Number.NEGATIVE_INFINITY)
      const displayStart = !case_.is_active && !case_.is_complete && backendDisplayStart.getTime() < previousFloor
        ? new Date(previousFloor)
        : backendDisplayStart
      const plannedEnd = !case_.is_active && !case_.is_complete
        ? new Date(displayStart.getTime() + case_.estimated_duration_min * 60_000)
        : dateOf(case_.planned_end)
      const backendVisualEnd = dateOf(case_.visual_end)
      const liveVisualEnd = case_.is_active && now > plannedEnd
        ? new Date(Math.max(backendVisualEnd.getTime(), now.getTime()))
        : !case_.is_active && !case_.is_complete
          ? plannedEnd
          : backendVisualEnd
      const originalPlannedStart = dateOf(case_.original_planned_start)
      const originalPlannedEnd = dateOf(case_.original_planned_end)
      const view = rangeBounds(now, range)

      floorItems.push({ visualEnd: liveVisualEnd })
      if (!overlapsRange(now, displayStart, liveVisualEnd, range) && !overlapsRange(now, originalPlannedStart, originalPlannedEnd, range)) continue

      const planned = getLeftWidth(now, displayStart, plannedEnd, range, timelineWidth)
      const visual = getLeftWidth(now, displayStart, liveVisualEnd, range, timelineWidth)
      const originalPlan = getLeftWidth(now, originalPlannedStart, originalPlannedEnd, range, timelineWidth)

      layouts.push({
        case_,
        displayStart,
        plannedEnd,
        x: ROOM_LABEL_WIDTH + timeToRangeFraction(now, displayStart, range) * timelineWidth,
        y,
        width: visual.width,
        plannedWidth: planned.width,
        overrunWidth: Math.max(0, visual.width - planned.width),
        visualOverrunMinutes: Math.max(0, Math.ceil((liveVisualEnd.getTime() - plannedEnd.getTime()) / 60_000)),
        originalPlanX: ROOM_LABEL_WIDTH + originalPlan.left,
        originalPlanWidth: originalPlan.width,
        rowIndex,
        continuesFromPreviousView: displayStart < view.start,
        continuesIntoNextView: liveVisualEnd > view.end,
      })
    }
  }

  return layouts.sort((a, b) => a.rowIndex - b.rowIndex || a.x - b.x)
}

function layoutGaps(gaps: ScreenGap[], range: TimeRange, timelineWidth: number, now: Date, roomIndexByCode: Map<string, number>, rowHeight: number): CanvasGapLayout[] {
  return gaps.flatMap((gap) => {
    const start = dateOf(gap.start)
    const end = dateOf(gap.end)
    const rowIndex = roomIndexByCode.get(gap.room_code)
    if (rowIndex === undefined || !overlapsRange(now, start, end, range)) return []
    const pos = getLeftWidth(now, start, end, range, timelineWidth, 42)
    return [{
      gap,
      x: ROOM_LABEL_WIDTH + pos.left,
      y: HEADER_HEIGHT + rowIndex * rowHeight,
      width: pos.width,
      rowIndex,
    }]
  })
}

export function buildProfessionalCanvasLayout(input: CanvasLayoutInput): ProfessionalCanvasLayout {
  const range = VIEW_RANGE[input.viewMode]
  const density = densityFor(input.pixelsPerHour)
  const sortedRooms = [...input.rooms].sort((a, b) => a.room_code.localeCompare(b.room_code, undefined, { numeric: true }))
  const rowHeight = rowHeightFor(sortedRooms.length, input.viewportHeight, input.pixelsPerHour)
  const timelineWidth = Math.max((range.endHour - range.startHour) * input.pixelsPerHour, MIN_TIMELINE_WIDTH)
  const roomIndexByCode = new Map(sortedRooms.map((room, index) => [room.room_code, index]))
  const rooms = sortedRooms.map((room, rowIndex) => ({ room, rowIndex, y: HEADER_HEIGHT + rowIndex * rowHeight }))
  const currentTimeX = overlapsRange(input.now, input.now, input.now, range)
    ? ROOM_LABEL_WIDTH + timeToRangeFraction(input.now, input.now, range) * timelineWidth
    : null

  return {
    range,
    density,
    width: ROOM_LABEL_WIDTH + timelineWidth,
    height: HEADER_HEIGHT + Math.max(1, sortedRooms.length) * rowHeight,
    timelineX: ROOM_LABEL_WIDTH,
    headerHeight: HEADER_HEIGHT,
    roomLabelWidth: ROOM_LABEL_WIDTH,
    rowHeight,
    timelineWidth,
    rooms,
    cases: layoutCases(input.cases, range, timelineWidth, input.now, roomIndexByCode, rowHeight),
    gaps: layoutGaps(input.gaps, range, timelineWidth, input.now, roomIndexByCode, rowHeight),
    currentTimeX,
  }
}
