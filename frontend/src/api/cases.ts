import api from './client'
import type { Case, CaseDetail, CasePhase, DelayReasonCode } from '../types'

export const listCases = () =>
  api.get<Case[]>('/api/v1/cases')

export const listAdminCases = () =>
  api.get<Case[]>('/api/v1/cases/admin')

export const getCase = (code: string) =>
  api.get<CaseDetail>(`/api/v1/cases/${code}`)

export const transitionCase = (code: string, to_phase: CasePhase, room_code?: string) =>
  api.post<{ outcome: string; from_phase: CasePhase; to_phase: CasePhase }>(
    `/api/v1/cases/${code}/transition`,
    room_code ? { to_phase, room_code } : { to_phase }
  )

export interface CaseCreatePayload {
  procedure_name: string
  estimated_duration_min: number
  scheduled_start: string
  scheduled_room_code: string
  doctor_id: string
  case_code?: string
  patient_id?: string
  patient_first_name?: string
  patient_last_name?: string
  patient_mrn?: string
  patient_age?: number
  patient_sex?: string
  company_names?: string[]
  isolation_required?: boolean
  notes?: string
  patient_room?: string
}

export const createCase = (data: CaseCreatePayload) =>
  api.post<Case>('/api/v1/cases', data)

export interface CaseUpdatePayload {
  procedure_name?: string
  estimated_duration_min?: number
  scheduled_start?: string
  scheduled_room_code?: string
  doctor_id?: string
  patient_id?: string | null
  patient_first_name?: string
  patient_last_name?: string
  patient_mrn?: string | null
  patient_age?: number | null
  patient_sex?: string | null
  company_names?: string[]
  isolation_required?: boolean
  notes?: string | null
  patient_room?: string | null
  actual_start_at?: string | null
  actual_end_at?: string | null
  expected_end_at?: string | null
}

export const updateCase = (code: string, data: CaseUpdatePayload) =>
  api.patch<Case>(`/api/v1/cases/${code}`, data)

export const deleteCase = (code: string) =>
  api.delete(`/api/v1/cases/${code}`)

export const resetVoiceCaseCodes = () =>
  api.post<Case[]>('/api/v1/cases/voice-codes/reset')

export const submitDelayReason = (code: string, reason: DelayReasonCode, note?: string) =>
  api.post<Case>(`/api/v1/cases/${code}/delay-reason`, { reason, note: note || null })

export const requestCancellation = (code: string) =>
  api.post<Case>(`/api/v1/cases/${code}/cancellation/request`)

export const confirmCancellation = (code: string, reason: string) =>
  api.post<Case>(`/api/v1/cases/${code}/cancellation/confirm`, { reason })

export const rejectCancellation = (code: string) =>
  api.post<Case>(`/api/v1/cases/${code}/cancellation/reject`)

export const cancelCaseDirect = (code: string, reason: string) =>
  api.post<Case>(`/api/v1/cases/${code}/cancellation/direct`, { reason })
