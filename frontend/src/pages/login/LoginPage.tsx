import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'
import { adminLogin, nurseLogin } from '../../api/auth'

type Role = 'admin' | 'nurse'

export default function LoginPage() {
  const [role, setRole] = useState<Role>('nurse')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const { setAuth } = useAuthStore()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (role === 'admin') {
        const res = await adminLogin(username, password)
        setAuth(res.data.access_token, 'admin', 'Admin')
        navigate('/admin')
      } else {
        const res = await nurseLogin(username, password)
        const name = `${res.data.first_name} ${res.data.last_name}`
        setAuth(res.data.access_token, 'nurse', name, res.data.nurse_id)
        navigate('/control')
      }
    } catch {
      setError('Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-[calc(100dvh-var(--app-nav-height))] items-center justify-center bg-white px-4 pb-[env(safe-area-inset-bottom)]">
      <div className="w-full max-w-80">

        {/* System name */}
        <p className="text-xs font-semibold uppercase tracking-widest text-[#94A3B8] text-center mb-8">
          ORTRACK
        </p>

        {/* Role toggle */}
        <div className="flex border border-[#E2E8F0] rounded-sm mb-6">
          {(['nurse', 'admin'] as Role[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => { setRole(r); setError('') }}
              className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wide transition-none ${
                role === r
                  ? 'bg-[#0F2044] text-white'
                  : 'bg-white text-[#475569] hover:opacity-80'
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            className="w-full px-3 py-2 border border-[#E2E8F0] rounded text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:ring-1 focus:ring-[#1D4ED8] focus:border-[#1D4ED8]"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full px-3 py-2 border border-[#E2E8F0] rounded text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:ring-1 focus:ring-[#1D4ED8] focus:border-[#1D4ED8]"
          />

          {error && (
            <p className="text-xs text-[#DC2626] text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 bg-[#0F2044] text-white text-xs font-semibold uppercase tracking-wide rounded-sm hover:opacity-90 disabled:opacity-50 mt-1"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}
