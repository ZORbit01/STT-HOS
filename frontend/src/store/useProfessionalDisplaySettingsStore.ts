import { create } from 'zustand'

export type ProfessionalViewMode = 'AM' | 'PM'
export type ProfessionalRoomGroup = 'PROF1' | 'PROF2'

interface ProfessionalDisplaySettings {
  viewMode: ProfessionalViewMode
  roomGroup: ProfessionalRoomGroup
  zoomIndex: number
  showPlannedIndicators: boolean
  followIndicator: boolean
}

interface ProfessionalDisplaySettingsStore extends ProfessionalDisplaySettings {
  setViewMode: (viewMode: ProfessionalViewMode) => void
  setRoomGroup: (roomGroup: ProfessionalRoomGroup) => void
  setZoomIndex: (zoomIndex: number) => void
  setShowPlannedIndicators: (showPlannedIndicators: boolean) => void
  setFollowIndicator: (followIndicator: boolean) => void
}

const COOKIE_NAME = 'ortrack_professional_display_settings'
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365
const MAX_ZOOM_INDEX = 19

const DEFAULT_SETTINGS: ProfessionalDisplaySettings = {
  viewMode: 'AM',
  roomGroup: 'PROF1',
  zoomIndex: 3,
  showPlannedIndicators: true,
  followIndicator: false,
}

function getCookie(name: string): string | null {
  const prefix = `${name}=`
  const value = document.cookie
    .split('; ')
    .find((cookie) => cookie.startsWith(prefix))
  return value ? decodeURIComponent(value.slice(prefix.length)) : null
}

function readSettingsCookie(): ProfessionalDisplaySettings {
  try {
    const raw = getCookie(COOKIE_NAME)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<ProfessionalDisplaySettings>
    return {
      viewMode: parsed.viewMode === 'PM' ? 'PM' : 'AM',
      roomGroup: parsed.roomGroup === 'PROF2' ? 'PROF2' : 'PROF1',
      zoomIndex: Number.isFinite(parsed.zoomIndex) ? Math.max(0, Math.min(MAX_ZOOM_INDEX, Number(parsed.zoomIndex))) : DEFAULT_SETTINGS.zoomIndex,
      showPlannedIndicators: typeof parsed.showPlannedIndicators === 'boolean' ? parsed.showPlannedIndicators : DEFAULT_SETTINGS.showPlannedIndicators,
      followIndicator: typeof parsed.followIndicator === 'boolean' ? parsed.followIndicator : DEFAULT_SETTINGS.followIndicator,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function writeSettingsCookie(settings: ProfessionalDisplaySettings) {
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(settings))}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`
}

function persist(next: ProfessionalDisplaySettings) {
  writeSettingsCookie(next)
  return next
}

const initialSettings = readSettingsCookie()

function update(state: ProfessionalDisplaySettings, patch: Partial<ProfessionalDisplaySettings>): ProfessionalDisplaySettings {
  return persist({ ...state, ...patch })
}

export const useProfessionalDisplaySettingsStore = create<ProfessionalDisplaySettingsStore>((set) => ({
  ...initialSettings,
  setViewMode: (viewMode) => set((state) => update(state, { viewMode })),
  setRoomGroup: (roomGroup) => set((state) => update(state, { roomGroup })),
  setZoomIndex: (zoomIndex) => set((state) => update(state, { zoomIndex: Math.max(0, Math.min(MAX_ZOOM_INDEX, zoomIndex)) })),
  setShowPlannedIndicators: (showPlannedIndicators) => set((state) => update(state, { showPlannedIndicators })),
  setFollowIndicator: (followIndicator) => set((state) => update(state, { followIndicator })),
}))
