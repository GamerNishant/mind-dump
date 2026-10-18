import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { focusRemainingMs } from '@/lib/plan'
import { useToday } from '@/state/PlannerProvider'

const TIME_UP_TITLE = '⏰ Time — Mind Dump'
const FLASH_MS = 30_000

/** Two soft sine tones. Browsers may block audio without a prior gesture; the toast still shows. */
function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    void ctx.resume().catch(() => {})
    const tone = (freq: number, start: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const t = ctx.currentTime + start
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.04)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.7)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.75)
    }
    tone(660, 0)
    tone(880, 0.35)
    window.setTimeout(() => void ctx.close().catch(() => {}), 1500)
  } catch {
    // No audio: the title and the toast still signal the end.
  }
}

/**
 * Always mounted (inside AppLayout). When the running focus block runs out while the user is
 * somewhere other than /focus, it chimes, flashes the tab title and shows a "Log it" toast.
 * On /focus itself FocusPage does this (and opens its End dialog), so this stays quiet there.
 * Fires once per (session, planned length): an extension that runs out fires again.
 */
export function FocusAlarm() {
  const { focus } = useToday()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const onFocusPage = pathname === '/focus'

  const running = focus && !focus.data.pausedAt && !focus.data.endedAt ? focus : null
  const runningId = running?.id ?? null
  const key = running ? `${running.id}:${running.data.plannedMin}` : null

  // A 1 s clock, only while a session is running (catches up when the tab becomes visible).
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!runningId) return
    const tick = () => setNow(Date.now())
    tick()
    const id = window.setInterval(tick, 1000)
    const onVisible = () => document.visibilityState === 'visible' && tick()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [runningId])

  const timeUp = running ? focusRemainingMs(running.data, new Date(now)) <= 0 : false

  const [flashing, setFlashing] = useState(false)
  const toastId = useRef<string | number | null>(null)
  const firedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!timeUp || !key || firedFor.current === key) return
    firedFor.current = key
    if (onFocusPage) return // FocusPage chimes and opens its End dialog.
    beep()
    setFlashing(true)
    toastId.current = toast("Block time's up", {
      description: running?.data.title,
      duration: FLASH_MS,
      action: { label: 'Log it', onClick: () => void navigate('/focus') },
    })
    // `running` is read for the description only; `key` covers the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeUp, key, onFocusPage, navigate])

  // Visiting /focus answers the alarm: stop flashing and drop the toast. A block that ended or
  // paused elsewhere (another device) stops the flashing too.
  useEffect(() => {
    if (!runningId) setFlashing(false)
    if (!onFocusPage) return
    setFlashing(false)
    if (toastId.current !== null) {
      toast.dismiss(toastId.current)
      toastId.current = null
    }
  }, [onFocusPage, runningId])

  // Alternate the tab title for up to 30 s, then restore it. Restoring runs in the effect cleanup,
  // before FocusPage's own title effect when the user navigates to /focus.
  const flashActive = flashing && !onFocusPage
  useEffect(() => {
    if (!flashActive) return
    const original = document.title === TIME_UP_TITLE ? 'Mind Dump' : document.title
    let on = true
    document.title = TIME_UP_TITLE
    const blink = window.setInterval(() => {
      on = !on
      document.title = on ? TIME_UP_TITLE : original
    }, 1000)
    const stop = window.setTimeout(() => setFlashing(false), FLASH_MS)
    return () => {
      window.clearInterval(blink)
      window.clearTimeout(stop)
      document.title = original
    }
  }, [flashActive])

  return null
}
