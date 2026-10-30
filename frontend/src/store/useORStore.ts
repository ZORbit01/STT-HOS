import { create } from 'zustand'
import type { AlertLevel, Case, Room, WSMessage } from '../types'

interface ORState {
  rooms: Room[]
  cases: Case[]
  lastMessage: WSMessage | null   // last WS event — display page subscribes for notifications
  setRooms: (rooms: Room[]) => void
  setCases: (cases: Case[]) => void
  applyWSMessage: (msg: WSMessage) => void
}

export const useORStore = create<ORState>((set) => ({
  rooms: [],
  cases: [],
  lastMessage: null,

  setRooms: (rooms) => set({ rooms }),
  setCases: (cases) => set({ cases }),

  applyWSMessage: (msg) => {
    set({ lastMessage: msg })

    switch (msg.event) {
      case 'phase_transition':
        set((state) => ({
          cases: state.cases.map((c) =>
            c.case_code === msg.payload.case_code
              ? {
                  ...c,
                  current_phase: msg.payload.to_phase,
                  actual_start_at: msg.payload.to_phase === 'IN'
                    ? new Date().toISOString()
                    : c.actual_start_at,
                  expected_end_at: msg.payload.to_phase === 'IN'
                    ? new Date(Date.now() + c.estimated_duration_min * 60_000).toISOString()
                    : msg.payload.to_phase === 'COMPLETE' || msg.payload.to_phase === 'CANCELLED' ? null : c.expected_end_at,
                  actual_end_at: msg.payload.to_phase === 'COMPLETE'
                    ? new Date().toISOString()
                    : c.actual_end_at,
                  cancellation_requested: msg.payload.to_phase === 'CANCELLED' ? false : c.cancellation_requested,
                }
              : c
          ),
          rooms: state.rooms.map((r) =>
            r.room_code === msg.payload.room_code
              ? {
                  ...r,
                  status: msg.payload.to_phase === 'COMPLETE' || msg.payload.to_phase === 'CANCELLED' ? 'AVAILABLE' : 'IN_USE',
                  active_case_code: msg.payload.to_phase === 'COMPLETE' || msg.payload.to_phase === 'CANCELLED' ? null : msg.payload.case_code,
                }
              : r
          ),
        }))
        break

      case 'cancellation_requested':
        set((state) => ({
          cases: state.cases.map((c) =>
            c.case_code === msg.payload.case_code
              ? {
                  ...c,
                  cancellation_requested: true,
                  cancellation_requested_at: msg.payload.requested_at,
                  cancellation_requested_by_nurse_name: msg.payload.requested_by_nurse_name,
                }
              : c
          ),
        }))
        break

      case 'alert':
        set((state) => ({
          cases: state.cases.map((c) =>
            c.case_code === msg.payload.case_code
              ? { ...c, alert_level: msg.payload.alert_level as AlertLevel }
              : c
          ),
        }))
        break

      case 'room_reassigned':
        set((state) => ({
          rooms: state.rooms.map((r) => {
            if (r.room_code === msg.payload.from_room)
              return { ...r, status: 'AVAILABLE', active_case_code: null }
            if (r.room_code === msg.payload.to_room)
              return { ...r, status: 'IN_USE', active_case_code: msg.payload.case_code }
            return r
          }),
        }))
        break

      case 'schedule_loaded':
        break

      case 'schedule_shifted':
        set((state) => ({
          cases: state.cases.map((c) => {
            const shift = msg.payload.shifts.find((s) => s.case_code === c.case_code)
            return shift ? { ...c, scheduled_start: shift.new_start } : c
          }),
        }))
        break
    }
  },
}))
