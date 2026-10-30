import api from './client'
import type { Surgery } from '../types'

export const listSurgeries = (includeInactive = false) =>
  api.get<Surgery[]>('/api/v1/surgeries', {
    params: { include_inactive: includeInactive },
  })

export const createSurgery = (body: { name: string }) =>
  api.post<Surgery>('/api/v1/surgeries', body)

export const updateSurgery = (
  id: string,
  body: Partial<Pick<Surgery, 'name' | 'is_active'>>,
) => api.patch<Surgery>(`/api/v1/surgeries/${id}`, body)

export const deleteSurgery = (id: string) =>
  api.delete(`/api/v1/surgeries/${id}`)
