import type { CasePhase } from '../../types'
import type { OrbState } from './types'

export const VALID_ROOMS = ['OR1', 'OR2', 'OR3', 'OR4', 'OR5', 'OR6', 'OR7', 'OR8', 'OR9', 'OR10', 'OR11', 'OR12']
export const DEVICE_PASSWORD = 'device-secret-123'
export const PHASE_STEPS: CasePhase[] = ['IN', 'INDUCTION', 'INCISION', 'CLOSURE', 'OUT', 'CLEANING']
export const PHASE_LABEL: Record<CasePhase, string> = {
  IDLE: 'Idle', IN: 'In', INDUCTION: 'Induction', INCISION: 'Incision',
  CLOSURE: 'Closure', OUT: 'Out', CLEANING: 'Cleaning',
  COMPLETE: 'Complete', CANCELLED: 'Cancelled',
}
export const PTT_MAX_MS = 6_000
export const PTT_MIN_MS = 300
export const WS_BACKOFF = [500, 1000, 2000, 4000, 4000]

export const ORB_COLOR: Record<OrbState, string> = {
  idle:       '#374151',
  wake_ready: '#0891B2',
  listening:  '#06B6D4',
  processing: '#06B6D4',
  accepted:   '#16A34A',
  rejected:   '#DC2626',
  review:     '#D97706',
}
