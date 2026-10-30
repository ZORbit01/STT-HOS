import type { Case } from '../types'

export const OR_START_HOUR = 7   // 7 AM
export const OR_END_HOUR = 20    // 8 PM
export const OR_DURATION_HOURS = OR_END_HOUR - OR_START_HOUR

/**
 * For each room, compute the display start time and duration of every case,
 * auto-cascading delays from overrunning cases to subsequent cases in the same room.
 */
export interface PositionedCase {
  case_: Case
  displayStart: Date    // actual display start (may be shifted)
  displayEnd: Date      // displayStart + estimated_duration_min
  scheduledStart: Date  // original from Excel
  overrunMin: number    // how many minutes this case is delayed
  isActive: boolean     // active workflow phase, not scheduled or complete
}

export function positionCases(cases: Case[]): PositionedCase[] {
  if (cases.length === 0) return []

  const now = new Date()

  // Sort by scheduled_start
  const sorted = [...cases].sort(
    (a, b) => new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime()
  )

  const result: PositionedCase[] = []
  let cascadeDelayMs = 0  // running delay that propagates forward

  for (const c of sorted) {
    const scheduledStart = new Date(c.scheduled_start)
    const durationMs = c.estimated_duration_min * 60_000

    // Apply accumulated cascade delay
    const displayStart = new Date(scheduledStart.getTime() + cascadeDelayMs)
    const displayEnd = new Date(displayStart.getTime() + durationMs)

    const isActive = c.current_phase !== 'IDLE' && c.current_phase !== 'COMPLETE'

    // Only cascade delay from active (in-progress) cases that have overrun
    let overrunMin = 0
    if (isActive && now > displayEnd) {
      overrunMin = Math.round((now.getTime() - displayEnd.getTime()) / 60_000)
      cascadeDelayMs += overrunMin * 60_000
    }

    // IDLE future cases: reset cascade if they haven't started yet
    // (only cascade within the same continuous block of active cases)
    if (!isActive && displayStart > now) {
      // keep cascade delay — future case is shifted
    }

    result.push({ case_: c, displayStart, displayEnd, scheduledStart, overrunMin, isActive })
  }

  return result
}

/** Convert a Date to a fraction (0–1) across the OR operating day */
export function timeToFraction(date: Date): number {
  const startOfDay = new Date(date)
  startOfDay.setHours(OR_START_HOUR, 0, 0, 0)
  const totalMs = OR_DURATION_HOURS * 3600_000
  const elapsed = date.getTime() - startOfDay.getTime()
  return Math.max(0, Math.min(1, elapsed / totalMs))
}

/** Format Date as HH:MM */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}
