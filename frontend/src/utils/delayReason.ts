import type { DelayReasonCode } from '../types'

export const DELAY_REASON_LABEL: Record<DelayReasonCode, string> = {
  INSTRUMENTS_NOT_READY: 'Instruments not ready',
  PATIENT_NOT_READY: 'Patient not ready',
  ANESTHESIA_DELAY: 'Anesthesia delay',
  STAFFING_SHORTAGE: 'Staffing shortage',
  SURGEON_LATE: 'Surgeon late',
  EQUIPMENT_ISSUE: 'Equipment issue',
  PREVIOUS_CASE_OVERRUN: 'Previous case overran',
  OTHER: 'Other',
}

export const DELAY_REASON_OPTIONS: DelayReasonCode[] = [
  'INSTRUMENTS_NOT_READY',
  'PATIENT_NOT_READY',
  'ANESTHESIA_DELAY',
  'STAFFING_SHORTAGE',
  'SURGEON_LATE',
  'EQUIPMENT_ISSUE',
  'OTHER',
]
