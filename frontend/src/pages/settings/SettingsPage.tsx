import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'

const CLIENT_PTT_HOTKEY_KEY = 'client:ptt-hotkey'
const CLIENT_PTT_HOTKEY_EVENT = 'client:ptt-hotkey-changed'
const DEFAULT_PTT_HOTKEY = 'Space'

function readPttHotkey() {
  return localStorage.getItem(CLIENT_PTT_HOTKEY_KEY) || DEFAULT_PTT_HOTKEY
}

function hotkeyLabel(code: string) {
  if (code === 'Space') return 'Space'
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`
  if (code.startsWith('Media')) return code.slice(5)
  return code
}

function savePttHotkey(code: string) {
  localStorage.setItem(CLIENT_PTT_HOTKEY_KEY, code)
  window.dispatchEvent(new Event(CLIENT_PTT_HOTKEY_EVENT))
}

function VoiceSettings() {
  const [pttHotkey, setPttHotkey] = useState(readPttHotkey)
  const [capturing, setCapturing] = useState(false)

  useEffect(() => {
    if (!capturing) return

    function onKeyDown(event: KeyboardEvent) {
      event.preventDefault()
      event.stopPropagation()
      savePttHotkey(event.code)
      setPttHotkey(event.code)
      setCapturing(false)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [capturing])

  function resetHotkey() {
    savePttHotkey(DEFAULT_PTT_HOTKEY)
    setPttHotkey(DEFAULT_PTT_HOTKEY)
    setCapturing(false)
  }

  return (
    <main className="px-4 py-5 sm:px-6 sm:py-6 lg:px-10">
      <div className="max-w-4xl">
        <div className="mb-4 flex items-end justify-between gap-4 border-b border-[#E2E8F0] pb-3">
          <div>
            <h2 className="text-lg font-black text-[#0F172A]">Voice controls</h2>
            <p className="mt-0.5 text-sm font-semibold text-[#64748B]">Pedal and push-to-talk input.</p>
          </div>
        </div>

        <div className="divide-y divide-[#E2E8F0] border-y border-[#E2E8F0]">
          <div className="grid gap-4 py-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div>
              <div className="text-sm font-black text-[#0F172A]">Pedal hotkey</div>
              <div className="mt-1 text-sm font-semibold text-[#64748B]">
                Press and hold this key to speak, release to send. Click Set then press any key — keyboard, foot pedal, or headset button.
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              <div className="flex h-10 min-w-28 items-center justify-center border border-[#CBD5E1] bg-[#F8FAFC] px-3 font-mono text-sm font-black text-[#0F172A]">
                {capturing ? '...' : hotkeyLabel(pttHotkey)}
              </div>
              <button
                type="button"
                onClick={() => setCapturing(true)}
                className={`h-10 px-4 text-xs font-black uppercase tracking-wide transition ${
                  capturing ? 'bg-[#F59E0B] text-white' : 'bg-[#0F2044] text-white hover:bg-[#19315F]'
                }`}
              >
                {capturing ? 'Press key' : 'Set'}
              </button>
              <button
                type="button"
                onClick={resetHotkey}
                className="h-10 border border-[#CBD5E1] px-4 text-xs font-black uppercase tracking-wide text-[#475569] hover:border-[#94A3B8]"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

export default function SettingsPage() {
  const { role } = useAuthStore()

  if (role !== 'nurse') return <Navigate to="/display" replace />

  return (
    <div className="min-h-[calc(100dvh-var(--app-nav-height))] bg-white">
      <div className="border-b border-[#D7DEE8] px-4 py-4 sm:px-6 sm:py-5 lg:px-10">
        <div className="text-xs font-black uppercase tracking-widest text-[#94A3B8]">Workstation</div>
        <h1 className="mt-1 text-2xl font-black tracking-tight text-[#0F172A]">Settings</h1>
      </div>

      <div className="grid min-h-[calc(100dvh-var(--app-nav-height)-6.5rem)] lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-4 lg:border-b-0 lg:border-r lg:px-6">
          <nav className="grid gap-1">
            <button
              type="button"
              className="h-10 border-l-4 border-[#0F2044] bg-white px-3 text-left text-xs font-black uppercase tracking-widest text-[#0F2044]"
            >
              Voice
            </button>
          </nav>
        </aside>

        <VoiceSettings />
      </div>
    </div>
  )
}
