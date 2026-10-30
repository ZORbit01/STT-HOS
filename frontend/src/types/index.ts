export type CasePhase = 'IDLE' | 'IN' | 'INDUCTION' | 'INCISION' | 'CLOSURE' | 'OUT' | 'CLEANING' | 'COMPLETE' | 'CANCELLED'
export type CaseType = 'SCHEDULED' | 'URGENT' | 'ADDON'
export type AlertLevel = 'NONE' | 'WARNING' | 'CRITICAL'
export type ScreenTimingStatus =
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'NEAR_END'
  | 'OVERRUN'
  | 'CRITICAL_OVERRUN'
  | 'COMPLETE'
  | 'IDLE'
export type ScreenAudience = 'professional' | 'visitor'
export type InputSource = 'VOICE' | 'BUTTON' | 'SYSTEM' | 'IMPORT'
export type TransitionOutcome = 'ACCEPTED' | 'REVIEW' | 'REJECTED' | 'DUPLICATE'
export type RoomStatus = 'AVAILABLE' | 'IN_USE'
export type DelayReasonCode =
  | 'INSTRUMENTS_NOT_READY'
  | 'PATIENT_NOT_READY'
  | 'ANESTHESIA_DELAY'
  | 'STAFFING_SHORTAGE'
  | 'SURGEON_LATE'
  | 'EQUIPMENT_ISSUE'
  | 'PREVIOUS_CASE_OVERRUN'
  | 'OTHER'

export interface Doctor {
  id: string
  first_name: string
  last_name: string
}

export interface Surgeon {
  id: string
  first_name: string
  last_name: string
  is_active: boolean
  created_at: string
}

export interface InductionPhysician {
  id: string
  first_name: string
  last_name: string
  is_active: boolean
  created_at: string
}

export interface NurseAccount {
  id: string
  username: string
  first_name: string
  last_name: string
  is_active: boolean
  created_at: string
}

export interface Patient {
  id: string
  first_name: string
  last_name: string
  mrn: string | null
  age: number | null
  sex: string | null
}

export interface Company {
  id: string
  name: string
  created_at?: string
}

export interface HospitalRoom {
  id: string
  name: string
  is_active: boolean
  created_at?: string
}

export interface Surgery {
  id: string
  name: string
  is_active: boolean
  created_at?: string
}

export interface Case {
  id: string
  case_code: string
  voice_case_code: string | null
  voice_code_day: string | null
  case_type: CaseType
  current_phase: CasePhase
  alert_level: AlertLevel
  procedure_name: string
  estimated_duration_min: number
  original_scheduled_start: string
  scheduled_start: string
  doctor: Doctor
  patient: Patient | null
  companies: Company[]
  isolation_required: boolean
  notes: string | null
  patient_room: string | null
  scheduled_room_code: string
  patient_name: string | null
  patient_age: number | null
  patient_sex: string | null
  actual_start_at: string | null
  expected_end_at: string | null
  actual_end_at: string | null
  induction_physician_id: string | null
  induction_physician_name: string | null
  delay_reason_required: boolean
  delay_reason: DelayReasonCode | null
  delay_reason_note: string | null
  cancellation_requested: boolean
  cancellation_requested_at: string | null
  cancellation_requested_by_nurse_name: string | null
  cancellation_reason: string | null
  cancellation_confirmed_at: string | null
}

export interface PhaseEvent {
  id: string
  from_phase: CasePhase
  to_phase: CasePhase
  source: InputSource
  outcome: TransitionOutcome
  raw_transcript: string | null
  confidence_score: number | null
  triggered_by_nurse_id: string | null
  triggered_by_nurse_name: string | null
  nurse_shift_id: string | null
  induction_physician_id: string | null
  induction_physician_name: string | null
  actual_time: string
  delay_minutes: number | null
}

export interface InductionPhysicianAssignment {
  id: string
  nurse_shift_id: string
  induction_physician_id: string
  induction_physician_name: string | null
  assigned_at: string
  ended_at: string | null
}

export interface CaseDetail extends Case {
  phase_events: PhaseEvent[]
  induction_assignments: InductionPhysicianAssignment[]
}

export interface Room {
  id: string
  room_code: string
  status: RoomStatus
  active_case_code: string | null
}

export interface ScreenTimeline {
  start_hour: number
  end_hour: number
  split_hour: number
}

export interface ScreenCase {
  id: string
  case_code: string
  voice_case_code: string | null
  case_type: CaseType
  room_id: string
  room_code: string
  current_phase: CasePhase
  phase_label: string
  alert_level: AlertLevel
  timing_status: ScreenTimingStatus
  status_label: string
  public_status_label: string
  procedure_name: string
  procedure_label: string
  physician_label: string
  patient_label: string
  public_patient_label: string
  original_planned_start: string
  original_planned_end: string
  scheduled_start: string
  display_start: string
  planned_end: string
  visual_end: string
  actual_start_at: string | null
  actual_end_at: string | null
  expected_end_at: string | null
  estimated_duration_min: number
  remaining_minutes: number | null
  overrun_minutes: number
  is_active: boolean
  is_complete: boolean
}

export interface ScreenGap {
  room_id: string
  room_code: string
  start: string
  end: string
  minutes: number
  label: string
}

export interface ScreenRoom {
  id: string
  room_code: string
  status: RoomStatus
  active_case_code: string | null
  phase: CasePhase
  phase_label: string
  alert_level: AlertLevel
  timing_status: ScreenTimingStatus
  status_label: string
  gap_count: number
  progress_percent: number
}

export interface ScreenState {
  generated_at: string
  audience: ScreenAudience
  timeline: ScreenTimeline
  rooms: ScreenRoom[]
  cases: ScreenCase[]
  gaps: ScreenGap[]
}

export type ScreenFeedKind = 'phase' | 'timing' | 'reschedule' | 'complete' | 'system'

export interface ScreenFeedEvent {
  id: string
  audience: ScreenAudience
  kind: ScreenFeedKind
  room_code: string | null
  case_code: string | null
  message: string
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface AuthTokens {
  access_token: string
  token_type: string
}

export interface NurseLoginResponse extends AuthTokens {
  nurse_id: string
  first_name: string
  last_name: string
}

export interface ClientRoomSession {
  session_id: string
  room_code: string
  nurse_id: string
  nurse_name: string
  induction_physician_id: string
  induction_physician_name: string
  expires_at: string
  nurse_shift_id?: string | null
}

export interface ClientRoomOccupancy {
  room_code: string
  occupied: boolean
  session: ClientRoomSession | null
}

// WebSocket message types
export interface WSPhaseTransition {
  event: 'phase_transition'
  payload: {
    case_code: string
    room_code: string
    from_phase: CasePhase
    to_phase: CasePhase
    source: InputSource
    confidence: number
    raw_transcript: string | null
    delay_minutes: number | null
  }
}

export interface WSAlert {
  event: 'alert'
  payload: {
    case_code: string
    room_code: string
    alert_level: AlertLevel
    phase: CasePhase
    elapsed_minutes: number
  }
}

export interface WSReviewNeeded {
  event: 'review_needed'
  payload: {
    room_code: string
    raw_transcript: string
    parsed_intent: { case_code: string; phase: string }
    confidence: number
    review_id: string
  }
}

export interface WSRoomReassigned {
  event: 'room_reassigned'
  payload: { case_code: string; from_room: string; to_room: string }
}

export interface WSScheduleLoaded {
  event: 'schedule_loaded'
  payload: { cases_created: number }
}

export interface WSScheduleShifted {
  event: 'schedule_shifted'
  payload: {
    room_code: string
    shifts: Array<{
      case_code: string
      old_start: string
      new_start: string
    }>
  }
}

export interface WSScreenState {
  event: 'screen_state'
  payload: {
    audience: ScreenAudience
    state: ScreenState
  }
}

export interface WSScreenFeedEvent {
  event: 'screen_feed_event'
  payload: ScreenFeedEvent
}

export interface WSCancellationRequested {
  event: 'cancellation_requested'
  payload: {
    case_code: string
    room_code: string
    requested_by_nurse_name: string | null
    requested_at: string
  }
}

export type WSMessage =
  | WSPhaseTransition
  | WSAlert
  | WSReviewNeeded
  | WSRoomReassigned
  | WSScheduleLoaded
  | WSScheduleShifted
  | WSScreenState
  | WSScreenFeedEvent
  | WSCancellationRequested
