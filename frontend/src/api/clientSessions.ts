import api from './client'
import type { ClientRoomOccupancy, ClientRoomSession } from '../types'

export const listClientRooms = () =>
  api.get<ClientRoomOccupancy[]>('/api/v1/client-sessions/rooms')

export const claimClientRoom = (roomCode: string, sessionId?: string | null, inductionPhysicianId?: string | null) =>
  api.post<ClientRoomSession>(`/api/v1/client-sessions/rooms/${roomCode}/claim`, {
    session_id: sessionId ?? null,
    induction_physician_id: inductionPhysicianId ?? null,
  })

export const releaseClientRoom = (roomCode: string, sessionId?: string | null) =>
  api.post(`/api/v1/client-sessions/rooms/${roomCode}/release`, { session_id: sessionId ?? null })
