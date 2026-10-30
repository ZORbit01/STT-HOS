import type { ScreenCase } from '../../../types'

type CaseLayout = {
  case_: ScreenCase
  leftPx: number
  widthPx: number
  plannedWidthPx: number
  originalPlanLeftPx: number
  originalPlanWidthPx: number
}

type PlannedIndicatorEndpoint = 'start' | 'end'

type PlannedIndicatorSegment = {
  key: string
  layout: CaseLayout
  blockPx: number
  originalPx: number
  label: string
  endpoint: PlannedIndicatorEndpoint
  minPx: number
  maxPx: number
  lane: number
}

const LANE_GAP_PX = 26
const LANE_STEP_PX = 14

function dateOf(value: string) {
  return new Date(value)
}

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

function getIndicatorTone(segment: PlannedIndicatorSegment) {
  const completedEarly = segment.layout.case_.is_complete && segment.endpoint === 'end' && segment.originalPx > segment.blockPx
  return completedEarly
    ? { backing: '#F0FDF4', stroke: '#16A34A', dot: '#16A34A', border: '#BBF7D0', text: '#15803D' }
    : { backing: '#FFF7ED', stroke: '#F97316', dot: '#F97316', border: '#FED7AA', text: '#EA580C' }
}

function buildSegment(layout: CaseLayout, endpoint: PlannedIndicatorEndpoint): PlannedIndicatorSegment {
  const { case_: case_, leftPx, widthPx, plannedWidthPx, originalPlanLeftPx, originalPlanWidthPx } = layout
  const blockPx = endpoint === 'start' ? leftPx : leftPx + (case_.is_complete ? widthPx : plannedWidthPx)
  const originalPx = endpoint === 'start' ? originalPlanLeftPx : originalPlanLeftPx + originalPlanWidthPx
  const labelSource = endpoint === 'start' ? case_.original_planned_start : case_.original_planned_end

  return {
    key: `${case_.id}-original-${endpoint}`,
    layout,
    blockPx,
    originalPx,
    label: formatTime(dateOf(labelSource)),
    endpoint,
    minPx: Math.min(blockPx, originalPx),
    maxPx: Math.max(blockPx, originalPx),
    lane: 0,
  }
}

function assignLanes(segments: PlannedIndicatorSegment[]) {
  const laneEnds: number[] = []
  for (const segment of segments) {
    const lane = laneEnds.findIndex((end) => segment.minPx > end + LANE_GAP_PX)
    segment.lane = lane === -1 ? laneEnds.length : lane
    laneEnds[segment.lane] = segment.maxPx
  }
  return segments
}

function buildSegments(layouts: CaseLayout[]) {
  const segments = layouts
    .flatMap((layout) => [buildSegment(layout, 'start'), buildSegment(layout, 'end')])
    .sort((a, b) => a.minPx - b.minPx)

  return assignLanes(segments)
}

function PlannedIndicator({ segment }: { segment: PlannedIndicatorSegment }) {
  const { layout, blockPx, originalPx, minPx, maxPx, lane, label } = segment
  const tone = getIndicatorTone(segment)
  const localBlock = blockPx - minPx
  const localOriginal = originalPx - minPx
  const widthPx = Math.max(1, maxPx - minPx)
  const railY = 6 + lane * LANE_STEP_PX
  const attachY = 17
  const labelTop = 23 + lane * LANE_STEP_PX
  const dotTop = attachY - 3
  const svgHeight = Math.max(40, labelTop + 18)
  const path = `M ${localBlock} ${attachY} L ${localBlock} ${railY} L ${localOriginal} ${railY} L ${localOriginal} ${attachY}`

  return (
    <div
      className="pointer-events-none absolute top-0 z-[35]"
      style={{ left: minPx, width: widthPx, height: svgHeight }}
      title={`Original plan ${formatTime(dateOf(layout.case_.original_planned_start))}-${formatTime(dateOf(layout.case_.original_planned_end))}`}
    >
      <svg className="absolute inset-0 overflow-visible" width={widthPx} height={svgHeight} viewBox={`0 0 ${widthPx} ${svgHeight}`} aria-hidden="true">
        <path d={path} fill="none" stroke={tone.backing} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" opacity="0.95" />
        <path d={path} fill="none" stroke={tone.stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="5 5" />
      </svg>
      <div className="absolute h-2 w-2 -translate-x-1/2 rounded-full border border-white shadow-sm" style={{ left: localOriginal, top: dotTop, backgroundColor: tone.dot }} />
      <div className="absolute -translate-x-1/2 whitespace-nowrap rounded-sm border bg-white/95 px-1 py-0.5 font-mono text-[9px] font-black shadow-sm" style={{ left: localOriginal, top: labelTop, borderColor: tone.border, color: tone.text }}>
        {label}
      </div>
    </div>
  )
}

export function ProfessionalPlannedIndicators({ layouts }: { layouts: CaseLayout[] }) {
  return (
    <>
      {buildSegments(layouts).map((segment) => (
        <PlannedIndicator key={segment.key} segment={segment} />
      ))}
    </>
  )
}
