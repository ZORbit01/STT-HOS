import { useCallback, useEffect, useRef, useState } from 'react'
import { screenLogin } from '../api/auth'
import { getScreenState } from '../api/screen'
import type { ScreenAudience, ScreenState, WSMessage } from '../types'

const SCREEN_USER = 'screen1'
const SCREEN_PASS = 'screen-secret-123'
const BACKOFF = [1000, 2000, 4000, 8000, 30000]
const RELOAD_EVENTS = new Set(['phase_transition', 'alert', 'room_reassigned', 'schedule_loaded', 'schedule_shifted'])

export function useScreenState(audience: ScreenAudience) {
  const [state, setState] = useState<ScreenState | null>(null)
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null)
  const tokenRef = useRef<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const retryRef = useRef(0)
  const deadRef = useRef(false)

  const reload = useCallback(async () => {
    try {
      const res = await getScreenState(audience)
      setState(res.data)
    } catch (error) {
      console.error('[screen-state] reload failed', error)
    }
  }, [audience])

  useEffect(() => {
    deadRef.current = false

    async function connect() {
      if (deadRef.current) return

      if (!tokenRef.current) {
        try {
          const res = await screenLogin(SCREEN_USER, SCREEN_PASS)
          tokenRef.current = res.data.access_token
        } catch (error) {
          console.error('[screen-state] login failed, retrying...', error)
          const delay = BACKOFF[Math.min(retryRef.current++, BACKOFF.length - 1)]
          window.setTimeout(connect, delay)
          return
        }
      }

      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${window.location.host}/ws/dashboard`)
      wsRef.current = ws

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'auth', token: tokenRef.current }))
      }

      ws.onmessage = (event) => {
        let msg: WSMessage | { type?: string }
        try {
          msg = JSON.parse(event.data)
        } catch {
          return
        }

        if ('type' in msg && msg.type === 'auth_ok') {
          retryRef.current = 0
          reload()
          return
        }

        if ('event' in msg) {
          if (msg.event === 'screen_state') {
            if (msg.payload.audience === audience) {
              setState(msg.payload.state)
            }
            return
          }

          setLastMessage(msg)
          if (RELOAD_EVENTS.has(msg.event)) reload()
        }
      }

      ws.onclose = () => {
        if (deadRef.current) return
        const delay = BACKOFF[Math.min(retryRef.current++, BACKOFF.length - 1)]
        window.setTimeout(connect, delay)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    reload()
    connect()
    return () => {
      deadRef.current = true
      wsRef.current?.close()
    }
  }, [reload])

  return { state, lastMessage, reload }
}
