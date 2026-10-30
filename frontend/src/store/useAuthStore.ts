import { create } from 'zustand'

type Role = 'admin' | 'nurse' | null

interface AuthState {
  token: string | null
  role: Role
  name: string | null
  nurseId: string | null
  setAuth: (token: string, role: Role, name: string, nurseId?: string | null) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('token'),
  role: localStorage.getItem('role') as Role,
  name: localStorage.getItem('name'),
  nurseId: localStorage.getItem('nurseId'),

  setAuth: (token, role, name, nurseId = null) => {
    localStorage.setItem('token', token)
    localStorage.setItem('role', role ?? '')
    localStorage.setItem('name', name)
    if (nurseId) localStorage.setItem('nurseId', nurseId)
    else localStorage.removeItem('nurseId')
    set({ token, role, name, nurseId })
  },

  clearAuth: () => {
    localStorage.removeItem('token')
    localStorage.removeItem('role')
    localStorage.removeItem('name')
    localStorage.removeItem('nurseId')
    set({ token: null, role: null, name: null, nurseId: null })
  },
}))
