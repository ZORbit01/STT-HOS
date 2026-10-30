import api from './client'
import type { HospitalRoom } from '../types'

export const listHospitalRooms = (includeInactive = false) =>
  api.get<HospitalRoom[]>('/api/v1/hospital-rooms', {
    params: { include_inactive: includeInactive },
  })

export const createHospitalRoom = (body: { name: string }) =>
  api.post<HospitalRoom>('/api/v1/hospital-rooms', body)

export const updateHospitalRoom = (
  id: string,
  body: Partial<Pick<HospitalRoom, 'name' | 'is_active'>>,
) => api.patch<HospitalRoom>(`/api/v1/hospital-rooms/${id}`, body)

export const deleteHospitalRoom = (id: string) =>
  api.delete(`/api/v1/hospital-rooms/${id}`)
