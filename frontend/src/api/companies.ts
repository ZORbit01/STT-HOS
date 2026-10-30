import api from './client'
import type { Company } from '../types'

export const listCompanies = () =>
  api.get<Company[]>('/api/v1/companies')

export const createCompany = (body: { name: string }) =>
  api.post<Company>('/api/v1/companies', body)

export const updateCompany = (id: string, body: { name: string }) =>
  api.patch<Company>(`/api/v1/companies/${id}`, body)

export const deleteCompany = (id: string) =>
  api.delete(`/api/v1/companies/${id}`)
