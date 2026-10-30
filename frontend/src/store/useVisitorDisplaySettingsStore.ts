import { create } from 'zustand'

interface VisitorDisplaySettingsStore {
  // When true, the visitor dashboard stops auto-rotating through room pages
  // and stays pinned to whatever page is showing.
  pageLocked: boolean
  setPageLocked: (pageLocked: boolean) => void
  togglePageLocked: () => void
}

const COOKIE_NAME = 'ortrack_visitor_display_settings'
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

function getCookie(name: string): string | null {
  const prefix = `${name}=`
  const value = document.cookie.split('; ').find((cookie) => cookie.startsWith(prefix))
  return value ? decodeURIComponent(value.slice(prefix.length)) : null
}

function readPageLocked(): boolean {
  try {
    const raw = getCookie(COOKIE_NAME)
    if (!raw) return false
    const parsed = JSON.parse(raw) as { pageLocked?: unknown }
    return parsed.pageLocked === true
  } catch {
    return false
  }
}

function persist(pageLocked: boolean) {
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify({ pageLocked }))}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`
}

export const useVisitorDisplaySettingsStore = create<VisitorDisplaySettingsStore>((set) => ({
  pageLocked: readPageLocked(),
  setPageLocked: (pageLocked) => set(() => { persist(pageLocked); return { pageLocked } }),
  togglePageLocked: () => set((state) => { const next = !state.pageLocked; persist(next); return { pageLocked: next } }),
}))
