import api from './client'
import type { Room, RoomStatus } from '../types'

export const listRooms = () =>
  api.get<Room[]>('/api/v1/rooms')

export const updateRoomStatus = (roomId: string, status: RoomStatus) =>
  api.patch<Room>(`/api/v1/rooms/${roomId}/status`, { status })
