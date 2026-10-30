import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ScreenCase, ScreenState } from '../../../types'
import { buildProfessionalCanvasLayout, ROOM_LABEL_WIDTH, type CanvasCaseLayout, type DragVisual, type ProfessionalCanvasLayout, type ProfessionalViewMode, ZOOM_LEVELS } from './professionalCanvasLayout'
import { drawProfessionalCanvas } from './professionalCanvasRenderer'

export type SwapProposal = {
  caseA: ScreenCase
  caseB: ScreenCase
}

type ProfessionalScheduleCanvasProps = {
  state: ScreenState | null
  now: Date
  viewMode: ProfessionalViewMode
  zoomIndex: number
  showPlannedIndicators: boolean
  followIndicator: boolean
  settingsControl: ReactNode
  onSelectCase?: (case_: ScreenCase) => void
  canDragReschedule?: boolean
  onRescheduleCase?: (proposal: RescheduleProposal) => void
  onSwapCases?: (proposal: SwapProposal) => void
  onZoomIndexChange?: (index: number) => void
}

export type PushedCaseProposal = {
  case_: ScreenCase
  fromStart: string
  toStart: string
  roomCode: string
  deltaMinutes: number
}

export type RescheduleProposal = {
  case_: ScreenCase
  fromStart: string
  toStart: string
  fromRoomCode: string
  toRoomCode: string
  deltaMinutes: number
  pushedCases: PushedCaseProposal[]
}

type Size = { width: number; height: number }
type ScrollOffset = { left: number; top: number }

type DragState = {
  caseLayout: CanvasCaseLayout
  pointerId: number
  startX: number
  startY: number
  lastX: number
  lastY: number
  grabOffsetX: number
  started: boolean
}

type BuildDragResult = {
  proposal: RescheduleProposal
  visual: DragVisual
}

function hitTestCaseLayout(layout: ProfessionalCanvasLayout, x: number, y: number): CanvasCaseLayout | null {
  for (let i = layout.cases.length - 1; i >= 0; i -= 1) {
    const cl = layout.cases[i]
    if (x >= cl.x && x <= cl.x + cl.width && y >= cl.y + 5 && y <= cl.y + layout.rowHeight - 5) return cl
  }
  return null
}

function shiftIsoByMinutes(value: string, minutes: number) {
  return new Date(new Date(value).getTime() + minutes * 60_000).toISOString()
}

function pixelsToMinutes(px: number, layout: ProfessionalCanvasLayout) {
  const rangeMinutes = (layout.range.endHour - layout.range.startHour) * 60
  return Math.round((px / layout.timelineWidth) * rangeMinutes)
}

function clampTimelineX(x: number, width: number, layout: ProfessionalCanvasLayout) {
  return Math.min(ROOM_LABEL_WIDTH + layout.timelineWidth - width, Math.max(ROOM_LABEL_WIDTH, x))
}

function buildDrag(
  layout: ProfessionalCanvasLayout,
  drag: DragState,
  now: Date,
  x: number,
  y: number,
): BuildDragResult {
  const source = drag.caseLayout.case_
  const ghostX = clampTimelineX(x - drag.grabOffsetX, drag.caseLayout.width, layout)
  const ghostRightX = ghostX + drag.caseLayout.width

  // Ghost lives in whatever row the mouse Y is in
  const ghostRowIndex = Math.max(0, Math.min(layout.rooms.length - 1, Math.floor((y - layout.headerHeight) / layout.rowHeight)))
  const targetRoomCode = layout.rooms[ghostRowIndex]?.room.room_code ?? source.room_code
  const targetRowY = layout.headerHeight + ghostRowIndex * layout.rowHeight

  // caseLayout.x is computed from display_start, so delta must be applied to display_start
  const deltaMinutes = pixelsToMinutes(ghostX - drag.caseLayout.x, layout)
  const toStart = shiftIsoByMinutes(source.display_start, deltaMinutes)

  const shiftedCases: DragVisual['shiftedCases'] = []
  const pushedCases: PushedCaseProposal[] = []

  const sourceRowY = drag.caseLayout.y

  // Only push source-room neighbors when the ghost is in the same row as the source
  if (ghostRowIndex === drag.caseLayout.rowIndex) {
    const candidates = layout.cases
      .filter((cl) => cl.case_.id !== source.id && cl.case_.room_code === source.room_code && !cl.case_.is_complete && !cl.case_.is_active)

    // Walk all candidates left-to-right.
    // Each block gets placed either fully to the left of the ghost or fully to the right —
    // determined by whether it originally sat left or right of the ghost's current center.
    // This ensures no block ever switches sides and no two blocks overlap.
    const ghostCenterX = ghostX + drag.caseLayout.width / 2

    // Blocks whose original center is LEFT of ghost center → pack them against the ghost's left edge
    const leftBlocks = candidates.filter((cl) => cl.x + cl.width / 2 < ghostCenterX).sort((a, b) => b.x - a.x)
    let leftFront = ghostX
    for (const cl of leftBlocks) {
      const newX = leftFront - cl.width
      leftFront = newX
      if (newX !== cl.x) {
        shiftedCases.push({ caseId: cl.case_.id, originalX: cl.x, ghostX: newX, ghostY: sourceRowY, ghostWidth: cl.width })
        pushedCases.push({ case_: cl.case_, fromStart: cl.case_.scheduled_start, toStart: shiftIsoByMinutes(cl.case_.scheduled_start, pixelsToMinutes(newX - cl.x, layout)), roomCode: cl.case_.room_code, deltaMinutes: pixelsToMinutes(newX - cl.x, layout) })
      }
    }

    // Blocks whose original center is RIGHT of ghost center → pack them against the ghost's right edge
    const rightBlocks = candidates.filter((cl) => cl.x + cl.width / 2 >= ghostCenterX).sort((a, b) => a.x - b.x)
    let rightFront = ghostRightX
    for (const cl of rightBlocks) {
      const newX = rightFront
      rightFront = newX + cl.width
      if (newX !== cl.x) {
        shiftedCases.push({ caseId: cl.case_.id, originalX: cl.x, ghostX: newX, ghostY: sourceRowY, ghostWidth: cl.width })
        pushedCases.push({ case_: cl.case_, fromStart: cl.case_.scheduled_start, toStart: shiftIsoByMinutes(cl.case_.scheduled_start, pixelsToMinutes(newX - cl.x, layout)), roomCode: cl.case_.room_code, deltaMinutes: pixelsToMinutes(newX - cl.x, layout) })
      }
    }
  }

  const proposal: RescheduleProposal = {
    case_: source,
    fromStart: source.display_start,
    toStart,
    fromRoomCode: source.room_code,
    toRoomCode: targetRoomCode,
    deltaMinutes,
    pushedCases,
  }

  const visual: DragVisual = {
    sourceCaseId: source.id,
    ghostX,
    ghostY: targetRowY,
    ghostWidth: drag.caseLayout.width,
    ghostHeight: layout.rowHeight,
    targetRowY,
    targetRowHeight: layout.rowHeight,
    moveType: new Date(toStart) < now ? 'past' : shiftedCases.length > 0 ? 'cascade' : 'free',
    shiftedCases,
    deltaMinutes,
    toRoomCode: targetRoomCode,
  }

  return { proposal, visual }
}

export function ProfessionalScheduleCanvas({
  state, now, viewMode, zoomIndex, showPlannedIndicators, followIndicator,
  settingsControl, onSelectCase, canDragReschedule = false, onRescheduleCase, onSwapCases, onZoomIndexChange,
}: ProfessionalScheduleCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState<Size>({ width: 1, height: 1 })
  const [scrollOffset, setScrollOffset] = useState<ScrollOffset>({ left: 0, top: 0 })
  const [hoveredCase, setHoveredCase] = useState<ScreenCase | null>(null)
  const [dragPreview, setDragPreview] = useState<RescheduleProposal | null>(null)
  const [dragVisual, setDragVisual] = useState<DragVisual | null>(null)
  const [swapSource, setSwapSource] = useState<ScreenCase | null>(null)
  const suppressClickRef = useRef(false)
  const dragRef = useRef<DragState | null>(null)
  const latestPreviewRef = useRef<RescheduleProposal | null>(null)
  const latestVisualRef = useRef<DragVisual | null>(null)
  const pixelsPerHour = ZOOM_LEVELS[zoomIndex] ?? ZOOM_LEVELS[3]
  const zoomIndexRef = useRef(zoomIndex)
  zoomIndexRef.current = zoomIndex

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: Math.max(1, Math.floor(entry.contentRect.width)), height: Math.max(1, Math.floor(entry.contentRect.height)) })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Mouse-wheel zoom: Ctrl+wheel or pinch-to-zoom, centered on cursor X position
  useEffect(() => {
    const container = scrollRef.current
    if (!container || !onZoomIndexChange) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && e.deltaMode === 0 && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      if (!e.ctrlKey && e.deltaMode === 0) return
      e.preventDefault()

      const delta = e.deltaY > 0 ? -1 : 1
      const oldIndex = zoomIndexRef.current
      const newIndex = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, oldIndex + delta))
      if (newIndex === oldIndex) return

      // Keep the timeline position under the cursor fixed after zoom
      const rect = container.getBoundingClientRect()
      const cursorLocalX = e.clientX - rect.left
      const timelineLocalX = Math.max(0, cursorLocalX - ROOM_LABEL_WIDTH)
      const oldPxPerHour = ZOOM_LEVELS[oldIndex]
      const newPxPerHour = ZOOM_LEVELS[newIndex]
      // fraction of timeline the cursor was at
      const fraction = (container.scrollLeft + timelineLocalX) / (oldPxPerHour * 12)
      const newScrollLeft = fraction * (newPxPerHour * 12) - timelineLocalX
      onZoomIndexChange(newIndex)
      // apply scroll after React re-renders layout; use rAF to let layout settle
      window.requestAnimationFrame(() => {
        container.scrollLeft = Math.max(0, newScrollLeft)
      })
    }
    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [onZoomIndexChange])

  const layout = useMemo(() => buildProfessionalCanvasLayout({
    rooms: state?.rooms ?? [],
    cases: state?.cases ?? [],
    gaps: state?.gaps ?? [],
    now,
    viewMode,
    pixelsPerHour,
    viewportWidth: size.width,
    viewportHeight: size.height,
  }), [now, pixelsPerHour, size.height, size.width, state?.cases, state?.gaps, state?.rooms, viewMode])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.ceil(size.width * ratio)
    canvas.height = Math.ceil(size.height * ratio)
    canvas.style.width = `${size.width}px`
    canvas.style.height = `${size.height}px`
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, size.width, size.height)
    drawProfessionalCanvas(ctx, layout, now, {
      showPlannedIndicators,
      hoveredCaseId: hoveredCase?.id ?? null,
      swapSourceCaseId: swapSource?.id ?? null,
      dragVisual,
      scrollLeft: scrollOffset.left,
      scrollTop: scrollOffset.top,
      viewportWidth: size.width,
      viewportHeight: size.height,
    })
  }, [dragVisual, hoveredCase?.id, layout, now, scrollOffset.left, scrollOffset.top, showPlannedIndicators, size.height, size.width])

  const updateScrollOffset = useCallback(() => {
    const container = scrollRef.current
    if (!container) return
    setScrollOffset({ left: container.scrollLeft, top: container.scrollTop })
  }, [])

  useEffect(() => {
    if (!followIndicator || layout.currentTimeX === null) return
    const container = scrollRef.current
    if (!container) return
    const visibleTimelineWidth = Math.max(1, container.clientWidth - ROOM_LABEL_WIDTH)
    container.scrollLeft = Math.max(0, layout.currentTimeX - ROOM_LABEL_WIDTH - visibleTimelineWidth / 2)
    updateScrollOffset()
  }, [followIndicator, layout.currentTimeX, layout.timelineWidth, updateScrollOffset])

  const clearDrag = () => {
    dragRef.current = null
    latestPreviewRef.current = null
    latestVisualRef.current = null
    setDragPreview(null)
    setDragVisual(null)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const localX = event.clientX - rect.left
    const localY = event.clientY - rect.top
    const x = localX + scrollOffset.left
    const y = localY + scrollOffset.top
    const drag = dragRef.current

    if (!drag) {
      if (localX < layout.roomLabelWidth || localY < layout.headerHeight) { setHoveredCase(null); return }
      setHoveredCase(hitTestCaseLayout(layout, x, y)?.case_ ?? null)
      return
    }

    if (drag.pointerId !== event.pointerId) return

    const dx = x - drag.startX
    const dy = y - drag.startY
    if (!drag.started && Math.hypot(dx, dy) < 8) return
    if (!drag.started) { drag.started = true; suppressClickRef.current = true }

    drag.lastX = x
    drag.lastY = y
    setHoveredCase(null)

    const result = buildDrag(layout, drag, now, x, y)
    latestPreviewRef.current = result.proposal
    latestVisualRef.current = result.visual
    setDragPreview(result.proposal)
    setDragVisual(result.visual)
  }

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return }
    const rect = event.currentTarget.getBoundingClientRect()
    const localX = event.clientX - rect.left
    const localY = event.clientY - rect.top
    if (localX < layout.roomLabelWidth || localY < layout.headerHeight) return
    const selected = hitTestCaseLayout(layout, localX + scrollOffset.left, localY + scrollOffset.top)
    if (selected) onSelectCase?.(selected.case_)
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canDragReschedule || event.button !== 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const localX = event.clientX - rect.left
    const localY = event.clientY - rect.top
    if (localX < layout.roomLabelWidth || localY < layout.headerHeight) return
    const x = localX + scrollOffset.left
    const y = localY + scrollOffset.top
    const caseLayout = hitTestCaseLayout(layout, x, y)
    if (!caseLayout || caseLayout.case_.is_active || caseLayout.case_.is_complete) return

    dragRef.current = {
      caseLayout,
      pointerId: event.pointerId,
      startX: x,
      startY: y,
      lastX: x,
      lastY: y,
      grabOffsetX: x - caseLayout.x,
      started: false,
    }
    latestPreviewRef.current = null
    latestVisualRef.current = null
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const finishDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch {}

    const proposal = latestPreviewRef.current
    const visual = latestVisualRef.current
    if (drag.started && proposal && visual && visual.moveType !== 'past') {
      onRescheduleCase?.(proposal)
    }

    clearDrag()
  }

  const handlePointerLeave = () => {
    if (!dragRef.current) setHoveredCase(null)
  }

  const handleContextMenu = (event: React.MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left + scrollOffset.left
    const y = event.clientY - rect.top + scrollOffset.top
    const hit = hitTestCaseLayout(layout, x, y)
    if (!hit || hit.case_.is_active || hit.case_.is_complete) {
      setSwapSource(null)
      return
    }
    if (!swapSource) {
      setSwapSource(hit.case_)
      return
    }
    if (swapSource.id === hit.case_.id) {
      setSwapSource(null)
      return
    }
    onSwapCases?.({ caseA: swapSource, caseB: hit.case_ })
    setSwapSource(null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSwapSource(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div ref={scrollRef} onScroll={updateScrollOffset} className="relative h-full min-h-0 overflow-auto border border-[#CBD5E1] bg-white shadow-sm">
      {layout.rooms.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm font-semibold text-[#64748B]">Connecting to schedule server...</div>
      ) : (
        <>
          <div style={{ position: 'relative', width: layout.width, height: layout.height }}>
            <canvas
              ref={canvasRef}
              onPointerMove={handlePointerMove}
              onPointerDown={handlePointerDown}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
              onClick={handleClick}
              onContextMenu={handleContextMenu}
              onPointerLeave={handlePointerLeave}
              className={`pointer-events-auto sticky left-0 top-0 block ${dragPreview ? 'cursor-grabbing' : swapSource ? 'cursor-crosshair' : hoveredCase ? canDragReschedule ? 'cursor-grab' : 'cursor-pointer' : 'cursor-default'}`}
            />
            <div className="sticky left-0 top-0 z-20 flex items-start justify-end border border-[#CBD5E1] bg-[#F8FAFC] p-2" style={{ width: layout.roomLabelWidth, height: layout.headerHeight, marginTop: -size.height }}>
              {settingsControl}
            </div>
          </div>
          {hoveredCase && !dragPreview && (
            <div className="pointer-events-none sticky bottom-3 left-3 z-10 w-fit max-w-[min(520px,calc(100vw-3rem))] border border-[#CBD5E1] bg-white/95 px-3 py-2 shadow-[0_10px_24px_rgba(15,23,42,0.18)] backdrop-blur">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-black text-[#0F172A]">{hoveredCase.procedure_label}</span>
                <span className="text-xs font-black text-[#64748B]">{hoveredCase.voice_case_code ?? hoveredCase.case_code}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-[#475569]">
                <span>{hoveredCase.room_code}</span>
                <span>{hoveredCase.patient_label}</span>
                <span>{hoveredCase.physician_label}</span>
                <span>{hoveredCase.status_label}</span>
                {hoveredCase.remaining_minutes !== null && (
                  <span>{hoveredCase.remaining_minutes >= 0 ? `${hoveredCase.remaining_minutes}m left` : `${Math.abs(hoveredCase.remaining_minutes)}m over`}</span>
                )}
              </div>
            </div>
          )}
          {dragPreview && dragVisual && (
            <div className={`pointer-events-none sticky bottom-3 left-3 z-20 w-fit px-3 py-2 shadow-[0_10px_24px_rgba(15,23,42,0.18)] backdrop-blur ${
              dragVisual.moveType === 'past' ? 'border border-[#94A3B8] bg-[#F8FAFC]/95' :
              dragVisual.moveType === 'cascade' ? 'border border-[#F59E0B] bg-[#FFFBEB]/95' :
              'border border-[#16A34A] bg-[#F0FDF4]/95'
            }`}>
              <div className={`text-xs font-black uppercase tracking-wide ${
                dragVisual.moveType === 'past' ? 'text-[#64748B]' :
                dragVisual.moveType === 'cascade' ? 'text-[#92400E]' :
                'text-[#166534]'
              }`}>
                {dragVisual.moveType === 'past' ? 'Cannot reschedule in the past' :
                 dragVisual.moveType === 'cascade' ? 'Push schedule' :
                 'Place here'}
              </div>
              {dragVisual.moveType !== 'past' && (
                <>
                  <div className="mt-1 text-sm font-black text-[#0F172A]">{dragPreview.case_.voice_case_code ?? dragPreview.case_.case_code} · {dragPreview.toRoomCode}</div>
                  <div className="mt-0.5 font-mono text-xs font-black text-[#475569]">
                    {new Date(dragPreview.toStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })} ({dragPreview.deltaMinutes >= 0 ? '+' : ''}{dragPreview.deltaMinutes}m)
                  </div>
                </>
              )}
            </div>
          )}
          {swapSource && !dragPreview && (
            <div className="pointer-events-none sticky bottom-3 left-3 z-20 w-fit border border-[#6366F1] bg-[#EEF2FF]/95 px-3 py-2 shadow-[0_10px_24px_rgba(15,23,42,0.18)] backdrop-blur">
              <div className="text-xs font-black uppercase tracking-wide text-[#4338CA]">Swap mode</div>
              <div className="mt-1 text-sm font-black text-[#0F172A]">{swapSource.voice_case_code ?? swapSource.case_code} selected</div>
              <div className="mt-0.5 text-xs font-semibold text-[#6366F1]">Right-click another block to swap · Esc to cancel</div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
