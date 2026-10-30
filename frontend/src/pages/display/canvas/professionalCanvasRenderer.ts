import type { AlertLevel, CasePhase, ScreenCase, ScreenTimingStatus } from '../../../types'
import { formatTime, PHASE_LABEL, PHASE_SEQUENCE, type CanvasCaseLayout, type CanvasDensity, type DragVisual, type ProfessionalCanvasLayout } from './professionalCanvasLayout'

const COLORS = {
  page: '#EDF1F5',
  panel: '#FFFFFF',
  header: '#F8FAFC',
  line: '#CBD5E1',
  lineSoft: '#E2E8F0',
  text: '#0F172A',
  muted: '#64748B',
  faint: '#94A3B8',
}

const TIMING_STYLE: Record<ScreenTimingStatus, { bg: string; border: string; text: string; strip: string }> = {
  SCHEDULED: { bg: '#F8FAFC', border: '#CBD5E1', text: '#475569', strip: '#64748B' },
  IN_PROGRESS: { bg: '#EAF7F1', border: '#B8E2CE', text: '#126B45', strip: '#16A34A' },
  NEAR_END: { bg: '#FFF7E6', border: '#F6D58B', text: '#8A5A00', strip: '#F59E0B' },
  OVERRUN: { bg: '#FFF1F2', border: '#FDA4AF', text: '#B91C1C', strip: '#F43F5E' },
  CRITICAL_OVERRUN: { bg: '#FEE2E2', border: '#F87171', text: '#991B1B', strip: '#DC2626' },
  COMPLETE: { bg: '#F1F5F9', border: '#CBD5E1', text: '#475569', strip: '#64748B' },
  IDLE: { bg: '#F8FAFC', border: '#CBD5E1', text: '#475569', strip: '#64748B' },
}

const CANCELLED_STYLE = { bg: '#FEF2F2', border: '#FCA5A5', text: '#DC2626', strip: '#DC2626' }

const PHASE_COLOR: Record<CasePhase, string> = {
  IDLE: '#64748B',
  IN: '#0284C7',
  INDUCTION: '#0D9488',
  INCISION: '#EA580C',
  CLOSURE: '#DB2777',
  OUT: '#7C3AED',
  CLEANING: '#059669',
  COMPLETE: '#16A34A',
  CANCELLED: '#DC2626',
}

const ALERT_COLOR: Record<AlertLevel, string> = {
  NONE: '#16A34A',
  WARNING: '#F59E0B',
  CRITICAL: '#DC2626',
}

type DrawOptions = {
  showPlannedIndicators: boolean
  hoveredCaseId: string | null
  swapSourceCaseId: string | null
  dragVisual: DragVisual | null
  scrollLeft: number
  scrollTop: number
  viewportWidth: number
  viewportHeight: number
}

type RectBox = {
  x: number
  y: number
  width: number
  height: number
}

type CaseCardGeometry = RectBox & {
  plannedWidth: number
}

type CaseTypography = {
  baseSize: number
  titleSize: number
  metaSize: number
}

type CaseContentLayout = {
  left: number
  right: number
  top: number
  bottom: number
  footerY: number
  titleBaseline: number
  metaBaseline: number
  railX: number
  railY: number
  railWidth: number
  railHeight: number
  showProcedure: boolean
  showMeta: boolean
  showFooter: boolean
  showRail: boolean
}

type PhaseRailMetrics = {
  activeIndex: number
  complete: boolean
  gap: number
  segmentWidth: number
  bandHeight: number
  contentScale: number
  labelSize: number
  microTile: boolean
  compactTile: boolean
  showLabel: boolean
  showGlyph: boolean
  glyphScale: number
}

type PhaseTile = {
  x: number
  y: number
  width: number
  height: number
  fill: string
  ink: string
  active: boolean
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width = 1) {
  ctx.beginPath()
  ctx.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5)
  ctx.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5)
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.stroke()
}

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, fill: string, stroke?: string) {
  ctx.beginPath()
  ctx.rect(Math.round(x), Math.round(y), Math.round(width), Math.round(height))
  ctx.fillStyle = fill
  ctx.fill()
  if (stroke) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = 1
    ctx.stroke()
  }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number, fill: string, stroke?: string, strokeWidth = 1) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + width - r, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + r)
  ctx.lineTo(x + width, y + height - r)
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  ctx.lineTo(x + r, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  if (stroke) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = strokeWidth
    ctx.stroke()
  }
}

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, options: { size?: number; weight?: number; color?: string; align?: CanvasTextAlign; baseline?: CanvasTextBaseline; maxWidth?: number; family?: string } = {}) {
  ctx.font = `${options.weight ?? 700} ${options.size ?? 12}px ${options.family ?? 'Inter, ui-sans-serif, system-ui, sans-serif'}`
  ctx.fillStyle = options.color ?? COLORS.text
  ctx.textAlign = options.align ?? 'left'
  ctx.textBaseline = options.baseline ?? 'alphabetic'
  ctx.fillText(value, x, y, options.maxWidth)
}

function clippedText(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, maxWidth: number, options: Parameters<typeof text>[4] = {}) {
  if (maxWidth <= 8) return
  let out = value
  while (out.length > 1 && ctx.measureText(out).width > maxWidth) {
    out = out.slice(0, -2)
  }
  text(ctx, out.length < value.length ? `${out}...` : out, x, y, { ...options, maxWidth })
}

function formatRulerTime(totalSeconds: number, startHour: number, includeSeconds: boolean) {
  const absoluteSeconds = startHour * 3600 + totalSeconds
  const hour = Math.floor(absoluteSeconds / 3600) % 24
  const minute = Math.floor((absoluteSeconds % 3600) / 60)
  const second = Math.floor(absoluteSeconds % 60)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}${includeSeconds ? `:${String(second).padStart(2, '0')}` : ''}`
}

function rulerSpec(layout: ProfessionalCanvasLayout) {
  const pixelsPerMinute = layout.timelineWidth / ((layout.range.endHour - layout.range.startHour) * 60)
  if (pixelsPerMinute >= 100) return { majorSeconds: 60, minorSeconds: 15, seconds: false }
  if (pixelsPerMinute >= 28) return { majorSeconds: 5 * 60, minorSeconds: 60, seconds: false }
  if (pixelsPerMinute >= 14) return { majorSeconds: 15 * 60, minorSeconds: 5 * 60, seconds: false }
  if (pixelsPerMinute >= 7) return { majorSeconds: 30 * 60, minorSeconds: 15 * 60, seconds: false }
  return { majorSeconds: 60 * 60, minorSeconds: 30 * 60, seconds: false }
}

function progressFraction(caseLayout: CanvasCaseLayout, now: Date) {
  const start = new Date(caseLayout.case_.display_start).getTime()
  const end = new Date(caseLayout.case_.planned_end).getTime()
  const total = Math.max(1, end - start)
  return Math.max(0, Math.min(1, (now.getTime() - start) / total))
}

function caseBand(layout: ProfessionalCanvasLayout) {
  return {
    top: 5,
    height: Math.max(44, layout.rowHeight - 10),
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

const CARD_DENSITY: Record<CanvasDensity, { title: number; base: number; meta: number; rail: number; pad: number }> = {
  compact: { title: 11, base: 9, meta: 8, rail: 26, pad: 7 },
  standard: { title: 13, base: 10, meta: 9, rail: 38, pad: 8 },
  expanded: { title: 16, base: 12, meta: 10, rail: 56, pad: 10 },
  deep: { title: 18, base: 13, meta: 11, rail: 74, pad: 12 },
}

function drawPhaseGlyph(ctx: CanvasRenderingContext2D, phase: CasePhase, cx: number, cy: number, color: string, scale: number) {
  const s = scale
  const stroke = Math.max(1.2, 2.1 * s)
  const softStroke = Math.max(1, 1.5 * s)
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = stroke
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (phase === 'IN') {
    ctx.strokeRect(cx - 10 * s, cy - 8 * s, 8 * s, 16 * s)
    ctx.beginPath()
    ctx.moveTo(cx - 9 * s, cy)
    ctx.lineTo(cx + 8 * s, cy)
    ctx.moveTo(cx + 3 * s, cy - 5 * s)
    ctx.lineTo(cx + 8 * s, cy)
    ctx.lineTo(cx + 3 * s, cy + 5 * s)
    ctx.stroke()
  } else if (phase === 'INDUCTION') {
    ctx.beginPath()
    ctx.arc(cx, cy, 8 * s, Math.PI * 0.15, Math.PI * 1.85)
    ctx.stroke()
    ctx.lineWidth = softStroke
    ctx.beginPath()
    ctx.moveTo(cx - 4 * s, cy)
    ctx.lineTo(cx - 1 * s, cy + 4 * s)
    ctx.lineTo(cx + 5 * s, cy - 5 * s)
    ctx.stroke()
  } else if (phase === 'INCISION') {
    ctx.beginPath()
    ctx.moveTo(cx - 9 * s, cy + 8 * s)
    ctx.lineTo(cx + 5 * s, cy - 6 * s)
    ctx.stroke()
    ctx.lineWidth = softStroke
    ctx.beginPath()
    ctx.moveTo(cx + 5 * s, cy - 6 * s)
    ctx.lineTo(cx + 10 * s, cy - 9 * s)
    ctx.moveTo(cx - 10 * s, cy + 9 * s)
    ctx.lineTo(cx - 3 * s, cy + 9 * s)
    ctx.stroke()
  } else if (phase === 'CLOSURE') {
    ctx.beginPath()
    ctx.moveTo(cx - 10 * s, cy - 4 * s)
    ctx.bezierCurveTo(cx - 6 * s, cy + 7 * s, cx - 2 * s, cy + 7 * s, cx + 2 * s, cy - 4 * s)
    ctx.bezierCurveTo(cx + 5 * s, cy - 11 * s, cx + 10 * s, cy - 8 * s, cx + 10 * s, cy - 2 * s)
    ctx.stroke()
    ctx.lineWidth = softStroke
    ctx.beginPath()
    ctx.moveTo(cx - 4 * s, cy + 4 * s)
    ctx.lineTo(cx + 4 * s, cy + 4 * s)
    ctx.stroke()
  } else if (phase === 'OUT') {
    ctx.strokeRect(cx + 2 * s, cy - 8 * s, 8 * s, 16 * s)
    ctx.beginPath()
    ctx.moveTo(cx - 10 * s, cy)
    ctx.lineTo(cx + 7 * s, cy)
    ctx.moveTo(cx + 2 * s, cy - 5 * s)
    ctx.lineTo(cx + 7 * s, cy)
    ctx.lineTo(cx + 2 * s, cy + 5 * s)
    ctx.stroke()
  } else if (phase === 'CLEANING') {
    ctx.lineWidth = softStroke
    for (const arm of [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]) {
      const dx = Math.cos(arm)
      const dy = Math.sin(arm)
      ctx.beginPath()
      ctx.moveTo(cx - dx * 9 * s, cy - dy * 9 * s)
      ctx.lineTo(cx + dx * 9 * s, cy + dy * 9 * s)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.arc(cx, cy, 2.1 * s, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function clip(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  ctx.beginPath()
  ctx.rect(x, y, Math.max(0, width), Math.max(0, height))
  ctx.clip()
}

function drawTimeHeader(ctx: CanvasRenderingContext2D, layout: ProfessionalCanvasLayout) {
  rect(ctx, layout.timelineX, 0, layout.timelineWidth, layout.headerHeight, COLORS.header, COLORS.line)

  const spec = rulerSpec(layout)
  const totalSeconds = (layout.range.endHour - layout.range.startHour) * 3600
  for (let seconds = 0; seconds <= totalSeconds; seconds += spec.minorSeconds) {
    const x = layout.timelineX + (seconds / totalSeconds) * layout.timelineWidth
    const major = seconds % spec.majorSeconds === 0
    const hour = seconds % 3600 === 0
    line(ctx, x, major ? 0 : layout.headerHeight * 0.68, x, layout.headerHeight, major ? COLORS.lineSoft : '#F1F5F9')
    if (major) {
      text(ctx, formatRulerTime(seconds, layout.range.startHour, spec.seconds), x + 8, 28, { size: 13, weight: 900, color: COLORS.muted })
      if (hour) text(ctx, formatRulerTime(seconds, layout.range.startHour, false).slice(0, 2) < '12' ? 'AM' : 'PM', x + 58, 28, { size: 9, weight: 900, color: COLORS.faint })
    }
  }
}

function drawTimelineGrid(ctx: CanvasRenderingContext2D, layout: ProfessionalCanvasLayout) {
  rect(ctx, layout.timelineX, layout.headerHeight, layout.timelineWidth, layout.height - layout.headerHeight, COLORS.panel)
  const spec = rulerSpec(layout)
  const totalSeconds = (layout.range.endHour - layout.range.startHour) * 3600
  for (let seconds = 0; seconds <= totalSeconds; seconds += spec.minorSeconds) {
    const x = layout.timelineX + (seconds / totalSeconds) * layout.timelineWidth
    const major = seconds % spec.majorSeconds === 0
    line(ctx, x, layout.headerHeight, x, layout.height, major ? COLORS.lineSoft : '#F1F5F9')
  }
  for (const roomLayout of layout.rooms) {
    line(ctx, layout.timelineX, roomLayout.y + layout.rowHeight, layout.width, roomLayout.y + layout.rowHeight, '#D7DEE8')
  }
}

function drawRoomLabels(ctx: CanvasRenderingContext2D, layout: ProfessionalCanvasLayout) {
  for (const roomLayout of layout.rooms) {
    const { room, y } = roomLayout
    rect(ctx, 0, y, layout.roomLabelWidth, layout.rowHeight, COLORS.header, COLORS.line)
    line(ctx, 0, y + layout.rowHeight, layout.roomLabelWidth, y + layout.rowHeight, '#D7DEE8')
    text(ctx, room.room_code, 14, y + 30, { size: 20, weight: 900 })
    rect(ctx, layout.roomLabelWidth - 22, y + 18, 10, 10, ALERT_COLOR[room.alert_level])
    text(ctx, room.phase_label, 14, y + 50, { size: 10, weight: 900, color: COLORS.muted })
    if (room.gap_count > 0) text(ctx, `${room.gap_count} gap${room.gap_count === 1 ? '' : 's'}`, 14, y + 67, { size: 9, weight: 900, color: COLORS.muted })

    rect(ctx, 14, y + layout.rowHeight - 18, layout.roomLabelWidth - 28, 6, '#E2E8F0')
    const progressWidth = ((layout.roomLabelWidth - 28) * room.progress_percent) / 100
    rect(ctx, 14, y + layout.rowHeight - 18, progressWidth, 6, room.active_case_code ? PHASE_COLOR[room.phase] : '#CBD5E1')
  }
}

function drawGaps(ctx: CanvasRenderingContext2D, layout: ProfessionalCanvasLayout) {
  for (const gapLayout of layout.gaps) {
    const y = gapLayout.y + 12
    const height = layout.rowHeight - 24
    rect(ctx, gapLayout.x, y, gapLayout.width, height, '#F8FAFC', '#CBD5E1')
    ctx.setLineDash([5, 5])
    ctx.strokeStyle = '#CBD5E1'
    ctx.strokeRect(Math.round(gapLayout.x), Math.round(y), Math.round(gapLayout.width), Math.round(height))
    ctx.setLineDash([])
    if (gapLayout.width >= 70) {
      text(ctx, 'GAP', gapLayout.x + gapLayout.width / 2, y + height / 2 - 4, { size: 10, weight: 900, color: COLORS.muted, align: 'center' })
      text(ctx, gapLayout.gap.label, gapLayout.x + gapLayout.width / 2, y + height / 2 + 12, { size: 10, weight: 900, color: COLORS.muted, align: 'center' })
    }
  }
}

function phaseBandColor(layout: CanvasCaseLayout, phase: CasePhase, index: number, activeIndex: number, complete: boolean) {
  if (layout.case_.current_phase === 'CANCELLED') return PHASE_COLOR.CANCELLED
  if (complete || (activeIndex >= 0 && index < activeIndex)) return '#4CAF3D'
  if (activeIndex === index) return PHASE_COLOR[phase]
  if (layout.case_.current_phase === 'IDLE') return '#E8EEF5'
  return '#E8EEF5'
}

function phaseShortLabel(phase: CasePhase) {
  if (phase === 'INDUCTION') return 'INDUCT'
  if (phase === 'INCISION') return 'INCISION'
  if (phase === 'CLOSURE') return 'CLOSE'
  if (phase === 'CLEANING') return 'CLEANING'
  return phase
}

function phaseRailMetrics(width: number, density: CanvasDensity, scale: number, showLabels: boolean): PhaseRailMetrics {
  const gap = Math.max(1, Math.min(3, width / 60))
  const segmentWidth = (width - gap * (PHASE_SEQUENCE.length - 1)) / PHASE_SEQUENCE.length
  const bandHeight = clamp(42 * scale, 20, showLabels ? 92 : 84)
  const contentScale = clamp(segmentWidth / 50, 0.35, 1.25)
  const microTile = segmentWidth < 34 || bandHeight < 30
  const compactTile = !microTile && density !== 'expanded' && density !== 'deep' && (bandHeight < 38 || segmentWidth < 46)
  const microGlyphScale = clamp(Math.min(segmentWidth / 24, bandHeight / 30), 0.2, 0.46)

  return {
    activeIndex: -1,
    complete: false,
    gap,
    segmentWidth,
    bandHeight,
    contentScale,
    labelSize: clamp(8 * contentScale, 6, 11),
    microTile,
    compactTile,
    showLabel: !microTile && segmentWidth >= 22,
    showGlyph: segmentWidth >= 8 && bandHeight >= 14,
    glyphScale: microTile ? microGlyphScale : compactTile ? clamp(contentScale * 0.5, 0.3, 0.6) : clamp(contentScale * 0.82, 0.48, 1.12),
  }
}

function phaseTile(layout: CanvasCaseLayout, phase: CasePhase, index: number, rail: PhaseRailMetrics, x: number, y: number): PhaseTile {
  const future = layout.case_.current_phase === 'IDLE' || (!rail.complete && rail.activeIndex >= 0 && index > rail.activeIndex)
  return {
    x: x + index * (rail.segmentWidth + rail.gap),
    y,
    width: rail.segmentWidth,
    height: rail.bandHeight,
    fill: phaseBandColor(layout, phase, index, rail.activeIndex, rail.complete),
    ink: future ? '#64748B' : '#FFFFFF',
    active: !rail.complete && rail.activeIndex === index,
  }
}

function drawPhaseTileBackground(ctx: CanvasRenderingContext2D, tile: PhaseTile) {
  roundedRect(ctx, tile.x, tile.y, tile.width, tile.height, Math.min(3, tile.width / 4), tile.fill, tile.ink === '#FFFFFF' ? '#FFFFFF' : '#CBD5E1')
  if (tile.active && tile.width >= 8) {
    roundedRect(ctx, tile.x + 1, tile.y + 1, tile.width - 2, tile.height - 2, 2, 'rgba(255,255,255,0.10)', '#FFFFFF')
  }
}

function drawPhaseTileLabel(ctx: CanvasRenderingContext2D, phase: CasePhase, tile: PhaseTile, rail: PhaseRailMetrics) {
  if (!rail.showLabel) return
  text(ctx, phaseShortLabel(phase), tile.x + tile.width / 2, tile.y + clamp(10 * rail.contentScale, 7, 12), {
    size: rail.compactTile ? clamp(rail.labelSize, 6, 7.5) : rail.labelSize,
    weight: 900,
    color: tile.ink,
    align: 'center',
    maxWidth: Math.max(10, tile.width - 4),
  })
}

function drawPhaseTileGlyph(ctx: CanvasRenderingContext2D, phase: CasePhase, tile: PhaseTile, rail: PhaseRailMetrics) {
  if (!rail.showGlyph) return
  const glyphX = tile.x + tile.width / 2
  const glyphY = rail.microTile ? tile.y + tile.height / 2 : tile.y + tile.height * (rail.showLabel ? 0.68 : 0.54)
  ctx.save()
  clip(ctx, tile.x + 1, tile.y + 1, Math.max(1, tile.width - 2), Math.max(1, tile.height - 2))
  drawPhaseGlyph(ctx, phase, glyphX, glyphY, tile.ink, rail.glyphScale)
  ctx.restore()
}

function drawDeepPhaseLabel(ctx: CanvasRenderingContext2D, phase: CasePhase, tile: PhaseTile, density: CanvasDensity, scale: number, showLabels: boolean) {
  if (!showLabels || density !== 'deep' || tile.width < 76) return
  text(ctx, PHASE_LABEL[phase], tile.x + tile.width / 2, tile.y + tile.height + 12 * scale, {
    size: clamp(8 * scale, 7, 10),
    weight: 800,
    color: tile.fill,
    align: 'center',
  })
}

function drawPhaseRail(ctx: CanvasRenderingContext2D, layout: CanvasCaseLayout, y: number, x: number, width: number, density: CanvasDensity, scale = 1, showLabels = false) {
  if (width < 40) return
  const rail = {
    ...phaseRailMetrics(width, density, scale, showLabels),
    activeIndex: PHASE_SEQUENCE.indexOf(layout.case_.current_phase),
    complete: layout.case_.current_phase === 'COMPLETE' || layout.case_.current_phase === 'CANCELLED',
  }

  for (const [index, phase] of PHASE_SEQUENCE.entries()) {
    const tile = phaseTile(layout, phase, index, rail, x, y)
    drawPhaseTileBackground(ctx, tile)
    drawPhaseTileLabel(ctx, phase, tile, rail)
    drawPhaseTileGlyph(ctx, phase, tile, rail)
    drawDeepPhaseLabel(ctx, phase, tile, density, scale, showLabels)
  }
}

function caseCardGeometry(layout: ProfessionalCanvasLayout, caseLayout: CanvasCaseLayout): CaseCardGeometry {
  const band = caseBand(layout)
  return {
    x: caseLayout.x,
    y: caseLayout.y + band.top,
    width: caseLayout.width,
    height: band.height,
    plannedWidth: caseLayout.overrunWidth > 0 ? Math.min(caseLayout.plannedWidth, caseLayout.width) : caseLayout.width,
  }
}

function caseDisplayCode(case_: ScreenCase) {
  return case_.voice_case_code ?? case_.case_code
}

function caseRemainingLabel(case_: ScreenCase) {
  if (case_.remaining_minutes === null) return ''
  return case_.remaining_minutes >= 0 ? `${case_.remaining_minutes}m` : `+${Math.abs(case_.remaining_minutes)}m`
}

function caseTimeLabel(case_: ScreenCase) {
  return caseRemainingLabel(case_) || `${formatTime(new Date(case_.display_start))}-${formatTime(new Date(case_.planned_end))}`
}

function caseTypography(density: CanvasDensity, card: CaseCardGeometry): CaseTypography {
  const densityProfile = CARD_DENSITY[density]
  const narrowScale = clamp(card.plannedWidth / 260, 0.78, 1)
  const heightScale = clamp(card.height / 120, 0.88, 1.42)
  return {
    baseSize: Math.round(clamp(densityProfile.base * heightScale * narrowScale, 8, 16)),
    titleSize: Math.round(clamp(densityProfile.title * heightScale * narrowScale, 10, 24)),
    metaSize: Math.round(clamp((densityProfile.meta + 1) * heightScale * narrowScale, 8, 14)),
  }
}

function caseContentLayout(layout: ProfessionalCanvasLayout, card: CaseCardGeometry, type: CaseTypography): CaseContentLayout {
  const densityProfile = CARD_DENSITY[layout.density]
  const top = card.y + densityProfile.pad
  const bottom = card.y + card.height - densityProfile.pad
  const showMeta = card.plannedWidth >= 130 && card.height >= 58
  const showFooter = card.height >= 44
  const footerY = bottom - (showFooter ? type.baseSize + 4 : 0)
  const titleBaseline = top + type.titleSize
  const metaBaseline = titleBaseline + type.metaSize + 4
  const headerBottom = showMeta ? metaBaseline + 3 : titleBaseline + 4
  const railTop = headerBottom + clamp(card.height * 0.08, 5, 14)
  const railBottom = footerY - clamp(card.height * 0.08, 5, 14)
  const railAvailable = railBottom - railTop
  const railWidth = card.plannedWidth - 16
  const railHeight = railAvailable >= 20 && railWidth >= 40 ? clamp(railAvailable, 24, densityProfile.rail) : 0

  return {
    left: card.x + 14,
    right: card.x + card.plannedWidth - 8,
    top,
    bottom,
    footerY,
    titleBaseline,
    metaBaseline,
    railX: card.x + 8,
    railY: railHeight > 0 ? railTop + Math.max(0, (railAvailable - railHeight) / 2) : railTop,
    railWidth,
    railHeight,
    showProcedure: card.plannedWidth >= 74 && card.height >= 42,
    showMeta,
    showFooter,
    showRail: railHeight > 0,
  }
}

function overrunPalette(case_: ScreenCase) {
  return case_.timing_status === 'CRITICAL_OVERRUN'
    ? { color: '#DC2626', bg: '#FEF2F2' }
    : { color: '#F59E0B', bg: '#FFFBEB' }
}

function drawCaseFrame(ctx: CanvasRenderingContext2D, case_: ScreenCase, card: CaseCardGeometry, hovered: boolean, swapSource: boolean) {
  const style = case_.current_phase === 'CANCELLED' ? CANCELLED_STYLE : TIMING_STYLE[case_.timing_status]
  roundedRect(ctx, card.x, card.y, card.plannedWidth, card.height, 5, swapSource ? '#EEF2FF' : '#FFFFFF', swapSource ? '#6366F1' : hovered ? '#0F2044' : style.border)
  // Left-edge status strip. A completed case gets a distinct green edge so finished
  // cases read at a glance, instead of the neutral grey the COMPLETE timing style uses.
  const stripColor = case_.current_phase === 'COMPLETE' ? PHASE_COLOR.COMPLETE : style.strip
  roundedRect(ctx, card.x, card.y, 6, card.height, 4, stripColor)
}

function drawCaseOverrun(ctx: CanvasRenderingContext2D, caseLayout: CanvasCaseLayout, card: CaseCardGeometry) {
  if (caseLayout.overrunWidth <= 0) return
  const { color, bg } = overrunPalette(caseLayout.case_)
  const extraX = card.x + card.plannedWidth
  const extraWidth = Math.min(caseLayout.overrunWidth, Math.max(28, card.width - card.plannedWidth))
  roundedRect(ctx, extraX, card.y, extraWidth, card.height, 4, bg, color, 0.5)
  for (let sx = extraX + 8; sx < extraX + extraWidth; sx += 18) {
    line(ctx, sx, card.y + card.height - 4, sx + Math.min(card.height, 42), card.y + 4, 'rgba(245,158,11,0.14)', 1.4)
  }
  line(ctx, extraX, card.y, extraX, card.y + card.height, color, 1.5)
  line(ctx, extraX, card.y + 1, extraX + extraWidth, card.y + 1, color, 1)
  line(ctx, extraX, card.y + card.height - 2, extraX + extraWidth, card.y + card.height - 2, color, 1)
  if (caseLayout.overrunWidth >= 34) {
    roundedRect(ctx, extraX + 5, card.y + 6, 42, 18, 3, bg, color)
    text(ctx, `+${Math.max(caseLayout.case_.overrun_minutes, caseLayout.visualOverrunMinutes)}m`, extraX + 26, card.y + 19, { size: 10, weight: 900, color, align: 'center' })
  }
}

function drawCaseAlert(ctx: CanvasRenderingContext2D, case_: ScreenCase, card: CaseCardGeometry) {
  if (case_.alert_level === 'NONE') return
  line(ctx, card.x + 2, card.y + 2, card.x + card.width - 2, card.y + 2, case_.alert_level === 'CRITICAL' ? '#DC2626' : '#F59E0B', 1)
}

function drawContinuationChevron(ctx: CanvasRenderingContext2D, x: number, y: number, height: number, direction: 'left' | 'right') {
  const inset = 8
  const centerY = y + height / 2
  ctx.beginPath()
  if (direction === 'left') {
    ctx.moveTo(x + inset, centerY)
    ctx.lineTo(x + inset + 7, centerY - 7)
    ctx.lineTo(x + inset + 7, centerY + 7)
  } else {
    ctx.moveTo(x - inset, centerY)
    ctx.lineTo(x - inset - 7, centerY - 7)
    ctx.lineTo(x - inset - 7, centerY + 7)
  }
  ctx.closePath()
  ctx.fillStyle = '#FFFFFF'
  ctx.fill()
}

function drawContinuationArrow(ctx: CanvasRenderingContext2D, card: CaseCardGeometry, side: 'left' | 'right') {
  const size = Math.min(16, Math.max(12, card.height * 0.2))
  const badgeX = side === 'left' ? card.x + 3 : card.x + card.width - 3 - size
  roundedRect(ctx, badgeX, card.y + 3, size, size, 3, '#0F2044', '#FFFFFF', 0.5)
  drawContinuationChevron(ctx, side === 'left' ? badgeX + size / 2 - 1 : badgeX + size / 2 + 1, card.y + 3, size, side)
}

function drawCaseContinuations(ctx: CanvasRenderingContext2D, caseLayout: CanvasCaseLayout, card: CaseCardGeometry) {
  const { continuesFromPreviousView, continuesIntoNextView } = caseLayout
  if (!continuesFromPreviousView && !continuesIntoNextView) return

  const badgeHeight = Math.min(20, Math.max(16, card.height * 0.22))
  const badgeY = card.y + 5
  const availableWidth = Math.max(0, card.width - 12)
  if (availableWidth < 34) {
    if (continuesFromPreviousView) drawContinuationArrow(ctx, card, 'left')
    if (continuesIntoNextView) drawContinuationArrow(ctx, card, 'right')
    return
  }

  const drawBadge = (label: string, side: 'left' | 'right') => {
    ctx.font = '900 9px Inter, ui-sans-serif, system-ui, sans-serif'
    const badgeWidth = Math.min(availableWidth, Math.max(48, Math.ceil(ctx.measureText(label).width + 22)))
    const badgeX = side === 'left' ? card.x + 6 : card.x + card.width - badgeWidth - 6
    roundedRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 3, '#0F2044', '#FFFFFF', 0.5)
    drawContinuationChevron(ctx, side === 'left' ? badgeX : badgeX + badgeWidth, badgeY, badgeHeight, side)
    clippedText(ctx, label, side === 'left' ? badgeX + 20 : badgeX + 7, badgeY + badgeHeight / 2 + 3, badgeWidth - 27, {
      size: 9,
      weight: 900,
      color: '#FFFFFF',
    })
  }

  if (continuesFromPreviousView) {
    drawBadge(`Started ${formatTime(caseLayout.displayStart)}`, 'left')
  }
  if (continuesIntoNextView) {
    drawBadge(`Continues to ${formatTime(caseLayout.plannedEnd)}`, 'right')
  }
}

function drawCaseProgress(ctx: CanvasRenderingContext2D, caseLayout: CanvasCaseLayout, card: CaseCardGeometry, now: Date) {
  const case_ = caseLayout.case_
  const activeProgress = case_.is_active ? progressFraction(caseLayout, now) : case_.is_complete ? 1 : 0
  if (activeProgress <= 0) return
  rect(ctx, card.x + 8, card.y + card.height - 5, Math.max(1, (card.plannedWidth - 16) * activeProgress), 3, TIMING_STYLE[case_.timing_status].strip)
}

function drawCaseHeader(ctx: CanvasRenderingContext2D, case_: ScreenCase, card: CaseCardGeometry, content: CaseContentLayout, type: CaseTypography, displayCode: string) {
  if (!content.showProcedure) {
    text(ctx, displayCode, content.left, content.titleBaseline, { size: type.titleSize, weight: 900 })
    return
  }

  const codeWidth = Math.ceil(ctx.measureText(displayCode).width + 14)
  const procedureWidth = card.plannedWidth - 24 - codeWidth
  if (procedureWidth >= 54) {
    clippedText(ctx, case_.procedure_label, content.left, content.titleBaseline, procedureWidth, { size: type.titleSize, weight: 900 })
    text(ctx, displayCode, content.right, content.titleBaseline, { size: Math.max(12, type.titleSize), weight: 900, color: COLORS.muted, align: 'right' })
  } else {
    clippedText(ctx, displayCode, content.left, content.titleBaseline, card.plannedWidth - 22, { size: type.titleSize, weight: 900 })
  }
}

function drawCaseMeta(ctx: CanvasRenderingContext2D, case_: ScreenCase, card: CaseCardGeometry, content: CaseContentLayout, type: CaseTypography) {
  if (!content.showMeta) return
  clippedText(ctx, case_.patient_label, content.left, content.metaBaseline, card.plannedWidth - 16, { size: type.metaSize, weight: 800, color: COLORS.muted })
}

function drawCasePhaseRail(ctx: CanvasRenderingContext2D, layout: ProfessionalCanvasLayout, caseLayout: CanvasCaseLayout, content: CaseContentLayout) {
  if (!content.showRail) return
  const phaseScale = clamp(content.railHeight / 42, 0.6, 1.4)
  const showPhaseLabels = content.railHeight >= 60 && content.railWidth >= 430
  drawPhaseRail(ctx, caseLayout, content.railY, content.railX, content.railWidth, layout.density, phaseScale, showPhaseLabels)
}

function drawCaseFooter(ctx: CanvasRenderingContext2D, case_: ScreenCase, card: CaseCardGeometry, content: CaseContentLayout, type: CaseTypography) {
  if (!content.showFooter) return
  const footBaseline = content.footerY + type.baseSize
  if (card.plannedWidth >= 150) {
    clippedText(ctx, case_.physician_label, content.left, footBaseline, Math.max(24, card.plannedWidth - 120), { size: type.baseSize, weight: 900, color: COLORS.muted })
  }
  text(ctx, caseTimeLabel(case_), content.right, footBaseline, {
    size: type.baseSize,
    weight: 900,
    color: caseRemainingLabel(case_) ? COLORS.text : COLORS.muted,
    align: 'right',
  })
}

function drawCaseContent(ctx: CanvasRenderingContext2D, layout: ProfessionalCanvasLayout, caseLayout: CanvasCaseLayout, card: CaseCardGeometry) {
  const case_ = caseLayout.case_
  const displayCode = caseDisplayCode(case_)
  const type = caseTypography(layout.density, card)
  const content = caseContentLayout(layout, card, type)

  ctx.save()
  clip(ctx, card.x + 7, card.y + 1, Math.max(1, card.plannedWidth - 10), card.height - 2)
  drawCaseHeader(ctx, case_, card, content, type, displayCode)
  drawCaseMeta(ctx, case_, card, content, type)
  drawCasePhaseRail(ctx, layout, caseLayout, content)
  drawCaseFooter(ctx, case_, card, content, type)
  ctx.restore()
}

function drawCase(ctx: CanvasRenderingContext2D, layout: ProfessionalCanvasLayout, caseLayout: CanvasCaseLayout, hovered: boolean, now: Date, swapSource = false) {
  const card = caseCardGeometry(layout, caseLayout)
  drawCaseFrame(ctx, caseLayout.case_, card, hovered, swapSource)
  drawCaseOverrun(ctx, caseLayout, card)
  drawCaseAlert(ctx, caseLayout.case_, card)
  drawCaseProgress(ctx, caseLayout, card, now)
  drawCaseContent(ctx, layout, caseLayout, card)
  drawCaseContinuations(ctx, caseLayout, card)
}

function drawPlannedIndicators(ctx: CanvasRenderingContext2D, layout: ProfessionalCanvasLayout) {
  for (const caseLayout of layout.cases) {
    const y = caseLayout.y + 1
    const blockStart = caseLayout.x
    const blockEnd = caseLayout.x + (caseLayout.case_.is_complete ? caseLayout.width : caseLayout.plannedWidth)
    const originalStart = caseLayout.originalPlanX
    const originalEnd = caseLayout.originalPlanX + caseLayout.originalPlanWidth
    const pairs = [
      { block: blockStart, original: originalStart, label: formatTime(new Date(caseLayout.case_.original_planned_start)) },
      { block: blockEnd, original: originalEnd, label: formatTime(new Date(caseLayout.case_.original_planned_end)) },
    ]

    for (const pair of pairs) {
      const min = Math.min(pair.block, pair.original)
      const max = Math.max(pair.block, pair.original)
      const railY = y + 5
      const attachY = y + 17
      ctx.setLineDash([5, 5])
      line(ctx, pair.block, attachY, pair.block, railY, '#F97316', 1)
      line(ctx, pair.block, railY, pair.original, railY, '#F97316', 1)
      line(ctx, pair.original, railY, pair.original, attachY, '#F97316', 1)
      ctx.setLineDash([])
      rect(ctx, pair.original - 3, attachY - 3, 6, 6, '#F97316', '#FFFFFF')
      if (max - min > 34) {
        rect(ctx, pair.original - 17, attachY + 2, 34, 14, '#FFFFFF', '#FED7AA')
        text(ctx, pair.label, pair.original, attachY + 13, { size: 9, weight: 900, color: '#EA580C', align: 'center', family: 'ui-monospace, SFMono-Regular, Menlo, monospace' })
      }
    }
  }
}

function drawCurrentTime(ctx: CanvasRenderingContext2D, layout: ProfessionalCanvasLayout, now: Date) {
  if (layout.currentTimeX === null) return
  line(ctx, layout.currentTimeX, layout.headerHeight, layout.currentTimeX, layout.height, '#DC2626', 2)
  drawCurrentTimeBadge(ctx, layout.currentTimeX, layout.headerHeight, now)
}

function drawCurrentTimeBadge(ctx: CanvasRenderingContext2D, x: number, headerHeight: number, now: Date) {
  rect(ctx, x - 24, headerHeight - 32, 48, 22, '#DC2626', '#B91C1C')
  text(ctx, formatTime(now), x, headerHeight - 17, { size: 10, weight: 900, color: '#FFFFFF', align: 'center' })
}

const DRAG_COLORS = {
  free: { row: 'rgba(22,163,74,0.06)', ghost: 'rgba(22,163,74,0.18)', border: '#16A34A', accent: '#16A34A' },
  swap: { row: 'rgba(99,102,241,0.07)', ghost: 'rgba(99,102,241,0.18)', border: '#6366F1', accent: '#6366F1' },
  cascade: { row: 'rgba(245,158,11,0.07)', ghost: 'rgba(245,158,11,0.18)', border: '#F59E0B', accent: '#F59E0B' },
  'room-move': { row: 'rgba(14,165,233,0.07)', ghost: 'rgba(14,165,233,0.18)', border: '#0EA5E9', accent: '#0EA5E9' },
  'room-move-conflict': { row: 'rgba(220,38,38,0.07)', ghost: 'rgba(220,38,38,0.18)', border: '#DC2626', accent: '#DC2626' },
  past: { row: 'rgba(100,116,139,0.06)', ghost: 'rgba(100,116,139,0.14)', border: '#94A3B8', accent: '#94A3B8' },
}

const DRAG_LABEL: Record<DragVisual['moveType'], string> = {
  free: 'INSERT',
  swap: 'SWAP',
  cascade: 'CASCADE',
  'room-move': 'MOVE ROOM',
  'room-move-conflict': 'CONFLICT',
  past: 'PAST',
}

function drawDragVisual(ctx: CanvasRenderingContext2D, layout: ProfessionalCanvasLayout, drag: DragVisual, cases: CanvasCaseLayout[]) {
  const palette = DRAG_COLORS[drag.moveType]
  const bandTop = 5
  const bandH = Math.max(44, layout.rowHeight - 10)

  // Target row tint
  rect(ctx, layout.roomLabelWidth, drag.targetRowY, layout.timelineWidth, drag.targetRowHeight, palette.row)

  // For each displaced/swapped case: vacancy outline at original position + arrow to new position.
  // The block itself is drawn translated to the new position in drawProfessionalCanvas.
  for (const shifted of drag.shiftedCases) {
    const origLayout = cases.find((c) => c.case_.id === shifted.caseId)
    if (!origLayout) continue

    // Vacancy: faded dashed outline where the block used to be
    ctx.save()
    ctx.globalAlpha = 0.32
    ctx.setLineDash([4, 4])
    roundedRect(ctx, shifted.originalX, origLayout.y + bandTop, origLayout.width, bandH, 5, palette.row, palette.border)
    ctx.setLineDash([])
    ctx.restore()

    // Arrow from original position to new position (handles diagonal for cross-room swap)
    const fromX = shifted.originalX + origLayout.width / 2
    const fromY = origLayout.y + bandTop + bandH / 2
    const toX = shifted.ghostX + shifted.ghostWidth / 2
    const toY = shifted.ghostY + bandTop + bandH / 2
    if (Math.hypot(toX - fromX, toY - fromY) > 16) {
      ctx.save()
      ctx.globalAlpha = 0.6
      const angle = Math.atan2(toY - fromY, toX - fromX)
      line(ctx, fromX, fromY, toX, toY, palette.accent, 1.5)
      line(ctx, toX - Math.cos(angle - 0.4) * 8, toY - Math.sin(angle - 0.4) * 8, toX, toY, palette.accent, 1.5)
      line(ctx, toX - Math.cos(angle + 0.4) * 8, toY - Math.sin(angle + 0.4) * 8, toX, toY, palette.accent, 1.5)
      ctx.restore()
    }

    // Swap label at the block's new position
    if (drag.moveType === 'swap') {
      ctx.save()
      text(ctx, '⇄', toX, toY + 5, { size: 16, weight: 900, color: palette.accent, align: 'center' })
      ctx.restore()
    }
  }

  // Dragged case ghost
  const ghostX = drag.ghostX
  const ghostY = drag.ghostY + bandTop
  const ghostW = drag.ghostWidth
  const ghostH = bandH

  ctx.save()
  ctx.globalAlpha = drag.moveType === 'past' ? 0.38 : 0.72
  roundedRect(ctx, ghostX, ghostY, ghostW, ghostH, 5, palette.ghost)
  ctx.globalAlpha = 1
  ctx.setLineDash([5, 4])
  roundedRect(ctx, ghostX, ghostY, ghostW, ghostH, 5, 'transparent', palette.border)
  ctx.setLineDash([])

  if (drag.moveType === 'past') {
    ctx.save()
    ctx.beginPath()
    ctx.rect(ghostX, ghostY, Math.max(0, ghostW), Math.max(0, ghostH))
    ctx.clip()
    ctx.globalAlpha = 0.18
    ctx.strokeStyle = '#64748B'
    ctx.lineWidth = 1.5
    for (let sx = ghostX - ghostH; sx < ghostX + ghostW + ghostH; sx += 12) {
      ctx.beginPath()
      ctx.moveTo(sx, ghostY)
      ctx.lineTo(sx + ghostH, ghostY + ghostH)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.restore()
  }

  roundedRect(ctx, ghostX, ghostY, 6, ghostH, 4, palette.accent)

  const labelStr = DRAG_LABEL[drag.moveType]
  const deltaStr = drag.moveType === 'past' ? 'IN THE PAST' : `${drag.deltaMinutes >= 0 ? '+' : ''}${drag.deltaMinutes}m`
  const midY = ghostY + ghostH / 2

  if (ghostW >= 120) {
    text(ctx, labelStr, ghostX + 14, midY - 6, { size: 10, weight: 900, color: palette.accent })
    text(ctx, drag.moveType === 'past' ? deltaStr : `${drag.toRoomCode}  ${deltaStr}`, ghostX + 14, midY + 10, { size: 12, weight: 900, color: drag.moveType === 'past' ? palette.accent : '#0F172A' })
  } else if (ghostW >= 48) {
    text(ctx, drag.moveType === 'past' ? '✕' : deltaStr, ghostX + ghostW / 2, midY + 5, { size: 11, weight: 900, color: palette.accent, align: 'center' })
  }

  ctx.restore()

  // Free-insert pin
  if (drag.moveType === 'free') {
    const pinX = ghostX
    const pinTop = drag.targetRowY + 6
    const pinBot = drag.targetRowY + drag.targetRowHeight - 6
    line(ctx, pinX, pinTop, pinX, pinBot, palette.accent, 2)
    ctx.beginPath()
    ctx.arc(pinX, pinTop + 4, 4, 0, Math.PI * 2)
    ctx.fillStyle = palette.accent
    ctx.fill()
  }
}

function drawVisibleCases(ctx: CanvasRenderingContext2D, layout: ProfessionalCanvasLayout, now: Date, options: DrawOptions) {
  const shiftedById = new Map(options.dragVisual?.shiftedCases.map((s) => [s.caseId, s]) ?? [])
  const sourceDragId = options.dragVisual?.sourceCaseId ?? null

  for (const caseLayout of layout.cases) {
    const id = caseLayout.case_.id
    if (id === sourceDragId) {
      ctx.save()
      ctx.globalAlpha = 0.22
      drawCase(ctx, layout, caseLayout, false, now)
      ctx.restore()
      continue
    }

    const shifted = shiftedById.get(id)
    if (shifted) {
      ctx.save()
      ctx.translate(shifted.ghostX - caseLayout.x, shifted.ghostY - caseLayout.y)
      drawCase(ctx, layout, caseLayout, false, now)
      ctx.restore()
      continue
    }

    drawCase(ctx, layout, caseLayout, options.hoveredCaseId === id, now, options.swapSourceCaseId === id)
  }
}

function drawScrollableTimelineLayer(ctx: CanvasRenderingContext2D, layout: ProfessionalCanvasLayout, now: Date, options: DrawOptions) {
  clip(ctx, layout.roomLabelWidth, layout.headerHeight, options.viewportWidth - layout.roomLabelWidth, options.viewportHeight - layout.headerHeight)
  ctx.translate(-options.scrollLeft, -options.scrollTop)
  drawTimelineGrid(ctx, layout)
  drawGaps(ctx, layout)
  drawVisibleCases(ctx, layout, now, options)
  if (options.showPlannedIndicators) drawPlannedIndicators(ctx, layout)
  drawCurrentTime(ctx, layout, now)
  if (options.dragVisual) drawDragVisual(ctx, layout, options.dragVisual, layout.cases)
}

function drawHeaderLayer(ctx: CanvasRenderingContext2D, layout: ProfessionalCanvasLayout, now: Date, options: DrawOptions) {
  clip(ctx, layout.roomLabelWidth, 0, options.viewportWidth - layout.roomLabelWidth, layout.headerHeight)
  ctx.translate(-options.scrollLeft, 0)
  drawTimeHeader(ctx, layout)
  if (layout.currentTimeX !== null) {
    drawCurrentTimeBadge(ctx, layout.currentTimeX, layout.headerHeight, now)
  }
}

function drawRoomLabelLayer(ctx: CanvasRenderingContext2D, layout: ProfessionalCanvasLayout, options: DrawOptions) {
  clip(ctx, 0, layout.headerHeight, layout.roomLabelWidth, options.viewportHeight - layout.headerHeight)
  ctx.translate(0, -options.scrollTop)
  drawRoomLabels(ctx, layout)
}

function drawFrozenChrome(ctx: CanvasRenderingContext2D, layout: ProfessionalCanvasLayout, options: DrawOptions) {
  rect(ctx, 0, 0, layout.roomLabelWidth, layout.headerHeight, COLORS.header, COLORS.line)
  line(ctx, layout.roomLabelWidth, 0, layout.roomLabelWidth, options.viewportHeight, COLORS.line)
  line(ctx, 0, layout.headerHeight, options.viewportWidth, layout.headerHeight, COLORS.line)
}

export function drawProfessionalCanvas(ctx: CanvasRenderingContext2D, layout: ProfessionalCanvasLayout, now: Date, options: DrawOptions) {
  rect(ctx, 0, 0, options.viewportWidth, options.viewportHeight, COLORS.panel)

  ctx.save()
  drawScrollableTimelineLayer(ctx, layout, now, options)
  ctx.restore()

  ctx.save()
  drawHeaderLayer(ctx, layout, now, options)
  ctx.restore()

  ctx.save()
  drawRoomLabelLayer(ctx, layout, options)
  ctx.restore()

  drawFrozenChrome(ctx, layout, options)
}
