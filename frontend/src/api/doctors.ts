import api from './client'
import type { Surgeon } from '../types'

export const listDoctors = (includeInactive = false) =>
  api.get<Surgeon[]>('/api/v1/doctors', {
    params: { include_inactive: includeInactive },
  })

export const createDoctor = (body: { first_name: string; last_name: string }) =>
  api.post<Surgeon>('/api/v1/doctors', body)

export const updateDoctor = (
  id: string,
  body: Partial<Pick<Surgeon, 'first_name' | 'last_name' | 'is_active'>>,
) =>
  api.patch<Surgeon>(`/api/v1/doctors/${id}`, body)

export const deleteDoctor = (id: string) =>
  api.delete(`/api/v1/doctors/${id}`)
