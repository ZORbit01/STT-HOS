import api from './client'
import type { ScreenAudience, ScreenFeedEvent, ScreenState } from '../types'

export const getScreenState = (audience: ScreenAudience) =>
  api.get<ScreenState>('/api/v1/screen/state', { params: { audience } })

export const getScreenFeed = (audience: ScreenAudience, limit = 60) =>
  api.get<ScreenFeedEvent[]>('/api/v1/screen/feed', { params: { audience, limit } })
