import { useEffect } from 'react'
import { useORStore } from '../store/useORStore'
import { listRooms } from '../api/rooms'
import { listCases } from '../api/cases'

const POLL_INTERVAL_MS = 2_000

export function useDisplayPoll() {
  const { setRooms, setCases } = useORStore()

  const load = () => {
    Promise.all([listRooms(), listCases()])
      .then(([r, c]) => { setRooms(r.data); setCases(c.data) })
      .catch(() => {})
  }

  useEffect(() => {
    load()
    const t = setInterval(load, POLL_INTERVAL_MS)
    return () => clearInterval(t)
  }, [])
}
