import api from './client'
import type { AuthTokens, NurseLoginResponse } from '../types'

export const adminLogin = (username: string, password: string) =>
  api.post<AuthTokens>('/auth/admin-login', { username, password })

export const nurseLogin = (username: string, password: string) =>
  api.post<NurseLoginResponse>('/auth/nurse-login', { username, password })

export const screenLogin = (username: string, password: string) =>
  api.post<AuthTokens & { location: string }>('/auth/screen-login', { username, password })

export const deviceLogin = (username: string, password: string) =>
  api.post<AuthTokens>('/auth/device-login', { username, password })

export const nurseLogout = () =>
  api.post('/auth/nurse-logout')
