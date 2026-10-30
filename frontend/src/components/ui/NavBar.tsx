import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'
import { useProfessionalDisplaySettingsStore, type ProfessionalRoomGroup } from '../../store/useProfessionalDisplaySettingsStore'
import { useVisitorDisplaySettingsStore } from '../../store/useVisitorDisplaySettingsStore'
import { nurseLogout } from '../../api/auth'
import { VALID_ROOMS } from '../../pages/client/constants'
import { SHIFT_ROOM_KEY } from '../../pages/client/shiftRoom'

const ROOM_GROUP_OPTIONS: { value: ProfessionalRoomGroup; label: string }[] = [
  { value: 'PROF1', label: 'Prof 1 · OR1–OR6' },
  { value: 'PROF2', label: 'Prof 2 · OR7–OR12' },
]
const DISPLAY_NAV_HIDE_DELAY_MS = 800

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function RoomGroupSwitcher() {
  const roomGroup = useProfessionalDisplaySettingsStore((settings) => settings.roomGroup)
  const setRoomGroup = useProfessionalDisplaySettingsStore((settings) => settings.setRoomGroup)

  return (
    <select
      aria-label="Room group"
      value={roomGroup}
      onChange={(event) => setRoomGroup(event.target.value as ProfessionalRoomGroup)}
      className="h-7 border border-white/20 bg-[#0F2044] px-2 text-[11px] font-bold text-white outline-none focus:border-white/50"
    >
      {ROOM_GROUP_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  )
}

function VisitorLockToggle() {
  const pageLocked = useVisitorDisplaySettingsStore((settings) => settings.pageLocked)
  const togglePageLocked = useVisitorDisplaySettingsStore((settings) => settings.togglePageLocked)

  return (
    <button
      type="button"
      onClick={togglePageLocked}
      aria-pressed={pageLocked}
      title={pageLocked ? 'Page locked — auto-rotation off' : 'Auto-rotating pages'}
      className={`flex h-7 items-center border px-2 text-[11px] font-bold uppercase tracking-wide ${
        pageLocked
          ? 'border-white/60 bg-white/15 text-white'
          : 'border-white/20 text-white/50 hover:text-white'
      }`}
    >
      {pageLocked ? 'Locked' : 'Rotating'}
    </button>
  )
}

function LiveClock() {
  const [t, setT] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="text-xs font-mono text-white/40">
      {t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  )
}

export default function NavBar() {
  const { token, name, role, clearAuth } = useAuthStore()
  const location = useLocation()
  const navigate = useNavigate()
  const shiftRoom = localStorage.getItem(SHIFT_ROOM_KEY)
  const micClientPath = shiftRoom && VALID_ROOMS.includes(shiftRoom) ? `/client/${shiftRoom}` : '/control'
  const [displayOpen, setDisplayOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [displayPosition, setDisplayPosition] = useState<{ left: number; top: number } | null>(null)
  const [desktopNavVisible, setDesktopNavVisible] = useState(true)
  const navHideTimer = useRef<number | undefined>(undefined)
  const displayButtonRef = useRef<HTMLButtonElement | null>(null)
  const displayRoute = location.pathname === '/display' || location.pathname === '/schedule'
  const displayMode = location.pathname === '/schedule' ? 'Professional' : 'Visitors'
  // `mobile: true` marks links that belong in the phone-portrait nurse experience.
  // Everything else (Settings, the Display dashboards) stays desktop/tablet-only —
  // those screens aren't useful to a nurse on a vertical phone.
  const links = [
    { to: micClientPath, label: 'MIC CLIENT', show: role === 'nurse', mobile: true },
    { to: '/admin', label: 'ADMIN', show: role === 'admin', mobile: true },
    { to: '/settings', label: 'SETTINGS', show: role === 'nurse', mobile: false },
  ]

  const displayLinks = [
    { to: '/display', label: 'Visitors' },
    { to: '/schedule', label: 'Professional' },
  ]

  useEffect(() => {
    function captureInstallPrompt(event: Event) {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }
    function installed() {
      setInstallPrompt(null)
    }
    window.addEventListener('beforeinstallprompt', captureInstallPrompt)
    window.addEventListener('appinstalled', installed)
    return () => {
      window.removeEventListener('beforeinstallprompt', captureInstallPrompt)
      window.removeEventListener('appinstalled', installed)
    }
  }, [])

  useEffect(() => {
    const desktopPointer = window.matchMedia('(min-width: 768px) and (hover: hover) and (pointer: fine)')

    function stopAutoHide() {
      document.documentElement.classList.remove('display-nav-overlay')
      window.clearTimeout(navHideTimer.current)
      setDesktopNavVisible(true)
    }

    function startAutoHide() {
      if (!displayRoute || !desktopPointer.matches) {
        stopAutoHide()
        return
      }
      document.documentElement.classList.add('display-nav-overlay')
      setDesktopNavVisible(true)
      window.clearTimeout(navHideTimer.current)
      if (!displayOpen) {
        navHideTimer.current = window.setTimeout(() => setDesktopNavVisible(false), DISPLAY_NAV_HIDE_DELAY_MS)
      }
    }

    function revealFromTopEdge(event: PointerEvent) {
      if (!displayRoute || !desktopPointer.matches) return
      if (event.clientY > 10) return
      setDesktopNavVisible(true)
      window.clearTimeout(navHideTimer.current)
      if (!displayOpen) {
        navHideTimer.current = window.setTimeout(() => setDesktopNavVisible(false), DISPLAY_NAV_HIDE_DELAY_MS)
      }
    }

    startAutoHide()
    window.addEventListener('pointermove', revealFromTopEdge, { passive: true })
    desktopPointer.addEventListener('change', startAutoHide)
    return () => {
      window.removeEventListener('pointermove', revealFromTopEdge)
      desktopPointer.removeEventListener('change', startAutoHide)
      stopAutoHide()
    }
  }, [displayOpen, displayRoute])

  async function installApp() {
    if (!installPrompt) return
    await installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(null)
  }

  const handleLogout = async () => {
    try { await nurseLogout() } catch { /* Session may already be expired. */ }
    localStorage.removeItem(SHIFT_ROOM_KEY)
    clearAuth()
    navigate('/login')
  }

  const toggleDisplayMenu = () => {
    const rect = displayButtonRef.current?.getBoundingClientRect()
    if (rect) {
      setDisplayPosition({ left: rect.left, top: rect.bottom + 4 })
    }
    setDisplayOpen((open) => !open)
  }

  const displayMenu = displayOpen && displayPosition
    ? createPortal(
      <div className="fixed z-[100000] w-40 border border-[#E2E8F0] bg-white shadow-lg" style={{ left: displayPosition.left, top: displayPosition.top }}>
        {displayLinks.map((link) => {
          const active = location.pathname === link.to
          return (
            <button
              key={link.to}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { setDisplayOpen(false); navigate(link.to) }}
              className={`flex w-full items-center text-left text-xs font-black uppercase tracking-widest transition-colors ${
                active
                  ? 'border-l-4 border-[#0F2044] bg-[#F8FAFC] text-[#0F2044]'
                  : 'border-l-4 border-transparent text-[#64748B] hover:border-[#CBD5E1] hover:bg-[#F8FAFC] hover:text-[#0F172A]'
              }`}
            >
              <span className="px-3 py-2.5">{link.label}</span>
            </button>
          )
        })}
      </div>,
      document.body,
    )
    : null

  return (
    <nav
      data-autohide-hidden={displayRoute && !desktopNavVisible ? 'true' : 'false'}
      onMouseEnter={() => window.clearTimeout(navHideTimer.current)}
      onMouseLeave={() => {
        if (!displayRoute || displayOpen) return
        window.clearTimeout(navHideTimer.current)
        navHideTimer.current = window.setTimeout(() => setDesktopNavVisible(false), DISPLAY_NAV_HIDE_DELAY_MS)
      }}
      className={`relative z-[1000] flex h-[var(--app-nav-height)] shrink-0 items-end justify-between bg-[#0F2044] px-4 pb-0 md:h-10 md:items-center md:px-6 ${displayRoute ? 'display-auto-hide-nav' : ''}`}
    >
      {displayMenu}
      <span className="flex h-14 items-center text-sm font-bold tracking-widest text-white md:h-auto">ORTRACK</span>

      <div className="hidden items-center gap-1 md:flex">
        <div className="relative">
          <button
            ref={displayButtonRef}
            type="button"
            onClick={toggleDisplayMenu}
            onBlur={() => window.setTimeout(() => setDisplayOpen(false), 120)}
            className={`flex h-10 items-center gap-2 px-3 text-xs ${
              location.pathname === '/display' || location.pathname === '/schedule'
                ? 'text-white border-b border-white'
                : 'text-white/50 hover:text-white'
            }`}
          >
            <span>DISPLAY</span>
            <span className="text-[10px] text-white/40">{displayMode}</span>
            <span className="text-[9px] text-white/40">▾</span>
          </button>

        </div>

        {location.pathname === '/schedule' && <RoomGroupSwitcher />}
        {location.pathname === '/display' && <VisitorLockToggle />}

        {links.filter((link) => link.show).map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `text-xs px-3 py-2 ${isActive ? 'text-white border-b border-white' : 'text-white/50 hover:text-white'}`
            }
          >
            {label}
          </NavLink>
        ))}
      </div>

      <div className="hidden items-center gap-4 md:flex">
        <LiveClock />
        {installPrompt && (
          <button type="button" onClick={installApp} className="text-xs font-bold text-white/70 hover:text-white">
            Install
          </button>
        )}
        {token ? (
          <>
            {name && <span className="text-xs text-white/40">{name}</span>}
            <button onClick={handleLogout} className="text-xs text-white/40 hover:text-white">
              Logout
            </button>
          </>
        ) : (
          <button type="button" onClick={() => navigate('/login')} className="text-xs font-bold text-white/70 hover:text-white">
            Login
          </button>
        )}
      </div>

      <div className="ml-auto flex items-center md:hidden">
        {!token && (
          <button type="button" onClick={() => navigate('/login')} className="flex h-12 items-center px-3 text-xs font-bold text-white/75 active:text-white">
            Login
          </button>
        )}
        <button
          type="button"
          aria-label="Open navigation"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((open) => !open)}
          className="mb-1 flex h-12 w-12 touch-manipulation items-center justify-center text-white"
        >
          <span className="text-2xl leading-none">{mobileOpen ? '×' : '☰'}</span>
        </button>
      </div>

      {mobileOpen && (
        <div className="absolute inset-x-0 top-full max-h-[calc(100dvh-var(--app-nav-height))] overflow-y-auto border-t border-white/10 bg-[#0F2044] px-3 py-3 shadow-2xl md:hidden">
          <div className="grid gap-1">
            {links.filter((link) => link.show && link.mobile).map((link) => (
              <NavLink key={link.to} to={link.to} onClick={() => setMobileOpen(false)} className={({ isActive }) => `flex min-h-12 items-center rounded-lg px-4 text-sm font-bold ${isActive ? 'bg-white text-[#0F2044]' : 'text-white/75 active:bg-white/10'}`}>
                {link.label}
              </NavLink>
            ))}
            {token && (
              <button type="button" onClick={handleLogout} className="mt-2 flex min-h-12 items-center rounded-lg border border-white/15 px-4 text-left text-sm font-bold text-white/75 active:bg-white/10">
                Logout{name ? ` · ${name}` : ''}
              </button>
            )}
            {installPrompt && (
              <button type="button" onClick={installApp} className="flex min-h-12 items-center rounded-lg bg-white px-4 text-left text-sm font-black text-[#0F2044]">
                Install ORTrack
              </button>
            )}
          </div>
        </div>
      )}
    </nav>
  )
}
