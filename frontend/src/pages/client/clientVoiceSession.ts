import { createContext, useContext } from 'react'
import type { UseClientVoiceReturn } from '../../hooks/useClientVoice'

export type ClientVoiceContextValue = UseClientVoiceReturn & {
  room: string
}

export const ClientVoiceContext = createContext<ClientVoiceContextValue | null>(null)

export function useClientVoiceSession() {
  return useContext(ClientVoiceContext)
}
