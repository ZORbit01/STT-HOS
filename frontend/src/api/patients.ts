import api from './client'
import type { Patient } from '../types'

export interface PatientCreatePayload {
  first_name: string
  last_name: string
  mrn?: string | null
  age?: number | null
  sex?: string | null
}

export const listPatients = () =>
  api.get<Patient[]>('/api/v1/patients')

export const createPatient = (data: PatientCreatePayload) =>
  api.post<Patient>('/api/v1/patients', data)

export const updatePatient = (id: string, data: Partial<PatientCreatePayload>) =>
  api.patch<Patient>(`/api/v1/patients/${id}`, data)

export const deletePatient = (id: string) =>
  api.delete(`/api/v1/patients/${id}`)
