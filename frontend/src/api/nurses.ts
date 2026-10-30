import api from './client'
import type { NurseAccount } from '../types'

export const listNurses = (includeInactive = false) =>
  api.get<NurseAccount[]>('/api/v1/nurses', {
    params: { include_inactive: includeInactive },
  })

export const createNurse = (body: {
  username: string
  password: string
  first_name: string
  last_name: string
}) => api.post<NurseAccount>('/api/v1/nurses', body)

export const updateNurse = (
  id: string,
  body: Partial<Pick<NurseAccount, 'username' | 'first_name' | 'last_name' | 'is_active'>> & {
    password?: string
  },
) => api.patch<NurseAccount>(`/api/v1/nurses/${id}`, body)

export const deleteNurse = (id: string) =>
  api.delete(`/api/v1/nurses/${id}`)
