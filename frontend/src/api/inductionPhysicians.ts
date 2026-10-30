import api from './client'
import type { InductionPhysician } from '../types'

export const listInductionPhysicians = (includeInactive = false) =>
  api.get<InductionPhysician[]>('/api/v1/induction-physicians', {
    params: { include_inactive: includeInactive },
  })

export const createInductionPhysician = (body: { first_name: string; last_name: string }) =>
  api.post<InductionPhysician>('/api/v1/induction-physicians', body)

export const updateInductionPhysician = (
  id: string,
  body: Partial<Pick<InductionPhysician, 'first_name' | 'last_name' | 'is_active'>>,
) =>
  api.patch<InductionPhysician>(`/api/v1/induction-physicians/${id}`, body)

export const deleteInductionPhysician = (id: string) =>
  api.delete(`/api/v1/induction-physicians/${id}`)
