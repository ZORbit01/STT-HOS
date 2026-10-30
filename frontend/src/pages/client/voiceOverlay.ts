export const OVERLAY_OPEN_KEY = 'client:sina-overlay-open'
export const OVERLAY_EVENT = 'client:sina-overlay-changed'

export function openClientVoiceOverlay() {
  localStorage.setItem(OVERLAY_OPEN_KEY, 'true')
  window.dispatchEvent(new Event(OVERLAY_EVENT))
}
