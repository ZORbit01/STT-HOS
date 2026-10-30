export type OrbState = 'idle' | 'wake_ready' | 'listening' | 'processing' | 'accepted' | 'rejected' | 'review'

export type VoiceState = 'IDLE' | 'WAKE_LISTENING' | 'CMD_RECORDING' | 'PROCESSING'

export type VadMode = 'ptt' | 'wake'
export type ClientMode = 'voice' | 'buttons'

export interface LastCommand {
  text: string
  time: string
  confidence: number
}