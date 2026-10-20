import { useEffect, useRef, useState } from 'react'
import { apiBase } from '../config/apiBase'

const TERMINAL = new Set(['DELIVERED', 'CANCELLED'])

/**
 * Secure live tracking for one delivery: authenticated WebSocket with REST
 * polling as a fallback. Stops reconnecting once the delivery is finished.
 * Browsers pause background tabs, so tracking resumes when the page is visible.
 */
export function useDeliveryTracking(deliveryId) {
  const [snapshot, setSnapshot] = useState(null)
  const [connection, setConnection] = useState('connecting')
  const finishedRef = useRef(false)

  useEffect(() => {
    if (!deliveryId) { setSnapshot(null); return undefined }
    let token = null
    try { token = localStorage.getItem('doorstep-token') } catch { token = null }
    if (!token) { setConnection('offline'); return undefined }
    finishedRef.current = false
    let active = true
    let socket
    let retryTimer
    let retryCount = 0
    let lastActive = false
    const endpoint = apiBase || import.meta.env.VITE_API_BASE_URL || 'https://mydoorstep-api.onrender.com'

    const markFinished = (status) => {
      if (!TERMINAL.has(status)) return
      finishedRef.current = true
      socket?.close()
      setConnection('ended')
    }
    const fetchSnapshot = async () => {
      try {
        const response = await fetch(`${endpoint}/api/deliveries/${deliveryId}/tracking`, { headers: { Authorization: `Bearer ${token}` } })
        if (!response.ok) throw new Error('Tracking snapshot request failed')
        const body = await response.json()
        if (!active) return
        setSnapshot(body)
        markFinished(body.delivery?.status)
        lastActive = Boolean(body.delivery?.active)
        // The live stream only exists while a rider is actively on the delivery.
        if (lastActive && (!socket || socket.readyState === WebSocket.CLOSED)) connect()
        if (!lastActive && !TERMINAL.has(body.delivery?.status)) setConnection('waiting')
      } catch {
        if (active && !finishedRef.current) setConnection('offline')
      }
    }
    const scheduleReconnect = () => {
      if (!active || finishedRef.current || !lastActive) return
      window.clearTimeout(retryTimer)
      retryTimer = window.setTimeout(connect, Math.min(30_000, 1000 * 2 ** retryCount))
      retryCount += 1
    }
    function connect() {
      if (!active || finishedRef.current || !lastActive || document.visibilityState !== 'visible') return
      if (socket && socket.readyState !== WebSocket.CLOSED) return
      setConnection('connecting')
      const websocketUrl = new URL(`${endpoint}/api/deliveries/${deliveryId}/live`)
      websocketUrl.protocol = websocketUrl.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = new WebSocket(websocketUrl, ['bearer', token])
      socket.onopen = () => { retryCount = 0; if (active) setConnection('live') }
      socket.onmessage = (event) => {
        let message
        try { message = JSON.parse(event.data) } catch { return }
        if (!active) return
        // The server sends both a flat shape and a `data` field; accept either.
        if (message.type === 'tracking.snapshot') { const data = message.data || message; setSnapshot(data); markFinished(data.delivery?.status) }
        if (message.type === 'tracking.location') {
          const location = message.data || message.location
          if (location) setSnapshot((current) => current ? { ...current, delivery: { ...current.delivery, location } } : current)
        }
        if (message.type === 'tracking.status') {
          const status = message.data?.status || message.status
          setSnapshot((current) => current ? { ...current, delivery: { ...current.delivery, status } } : current)
          fetchSnapshot()
          markFinished(status)
        }
      }
      socket.onclose = () => { if (active && !finishedRef.current) { setConnection('offline'); scheduleReconnect() } }
      socket.onerror = () => socket.close()
    }
    const refresh = () => {
      if (document.visibilityState !== 'visible' || finishedRef.current) return
      fetchSnapshot()
    }
    fetchSnapshot()
    const pollingTimer = window.setInterval(() => { if (!finishedRef.current && document.visibilityState === 'visible') fetchSnapshot() }, 15_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      active = false
      window.clearTimeout(retryTimer)
      window.clearInterval(pollingTimer)
      document.removeEventListener('visibilitychange', refresh)
      socket?.close()
    }
  }, [deliveryId])

  return { snapshot, connection, refreshKey: snapshot?.delivery?.status }
}
