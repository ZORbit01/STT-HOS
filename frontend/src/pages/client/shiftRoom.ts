export const SHIFT_ROOM_KEY = 'ortrack:shift-room'
export const SHIFT_ROOM_EVENT = 'ortrack:shift-room-changed'

export function notifyShiftRoomChanged() {
  window.dispatchEvent(new Event(SHIFT_ROOM_EVENT))
}
