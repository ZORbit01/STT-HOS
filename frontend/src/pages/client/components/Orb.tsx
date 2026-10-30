import { ORB_COLOR } from '../constants'
import type { OrbState } from '../types'

type OrbSize = 'normal' | 'compact' | 'mini'

interface OrbProps {
  state: OrbState
  amplitude: number
  size?: OrbSize
}

const ORB_DIMENSIONS: Record<OrbSize, { container: number; base: number; amp: number; ringPad: number; ringStep: number }> = {
  normal: { container: 220, base: 104, amp: 42, ringPad: 34, ringStep: 25 },
  compact: { container: 146, base: 66, amp: 26, ringPad: 22, ringStep: 17 },
  mini: { container: 64, base: 40, amp: 12, ringPad: 10, ringStep: 8 },
}

export function Orb({ state, amplitude, size: scale = 'normal' }: OrbProps) {
  const color = ORB_COLOR[state]
  const dims = ORB_DIMENSIONS[scale]
  const live = state === 'listening' || state === 'wake_ready'
  const extra = live ? amplitude * dims.amp : 0
  const size = dims.base + extra
  const pulse = state === 'idle' || state === 'processing' || state === 'wake_ready'
  const ripple = state === 'listening' || state === 'wake_ready'

  return (
    <div className="relative flex items-center justify-center" style={{ width: dims.container, height: dims.container }}>
      {ripple && [0, 1, 2].map((i) => (
        <div key={i} className="absolute rounded-full pointer-events-none" style={{
          width: size + dims.ringPad + i * dims.ringStep,
          height: size + dims.ringPad + i * dims.ringStep,
          border: `1.5px solid ${color}`,
          opacity: 0.25 - i * 0.07,
          animation: `orb-ripple 1.8s ease-out infinite ${i * 0.45}s`,
        }} />
      ))}
      <div className="rounded-full flex items-center justify-center" style={{
        width: size, height: size,
        backgroundColor: color,
        transition: 'width 0.15s ease, height 0.15s ease, background-color 0.4s ease',
        animation: pulse ? 'orb-breathe 3s ease-in-out infinite' : undefined,
        opacity: state === 'idle' ? 0.7 : 1,
        boxShadow: live ? `0 0 ${18 + amplitude * 38}px ${color}55` : undefined,
      }} />
      {state === 'processing' && (
        <div className="absolute rounded-full pointer-events-none" style={{
          width: size + 16, height: size + 16,
          border: '2px solid transparent', borderTopColor: color,
          animation: 'orb-spin 0.9s linear infinite',
        }} />
      )}
    </div>
  )
}
