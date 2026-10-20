/**
 * A short confetti burst: a small reward for finishing something, so coming back feels good.
 * Pure DOM + Web Animations (no library). Skipped entirely with prefers-reduced-motion, and
 * cleans itself up after the animation.
 */

const COLORS = ['#6c3fe0', '#c2255c', '#f59e0b', '#10b981', '#38bdf8', '#f472b6']

export type CelebrateSize = 'small' | 'big'

/** Burst from a point (viewport px), or from an element's centre, or from the upper middle. */
export function celebrate(origin?: Element | { x: number; y: number } | null, size: CelebrateSize = 'small'): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  if (typeof Element.prototype.animate !== 'function') return

  let x = window.innerWidth / 2
  let y = window.innerHeight * 0.35
  if (origin instanceof Element) {
    const r = origin.getBoundingClientRect()
    x = r.left + r.width / 2
    y = r.top + r.height / 2
  } else if (origin) {
    ;({ x, y } = origin)
  }

  const count = size === 'big' ? 48 : 18
  const spread = size === 'big' ? 260 : 120
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('span')
    piece.className = 'confetti-piece'
    piece.setAttribute('aria-hidden', 'true')
    const w = 5 + Math.random() * 5
    piece.style.width = `${w}px`
    piece.style.height = `${w * (0.4 + Math.random() * 0.8)}px`
    piece.style.background = COLORS[i % COLORS.length]
    document.body.append(piece)

    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1
    const distance = spread * (0.5 + Math.random() * 0.6)
    const dx = Math.cos(angle) * distance
    const dy = Math.sin(angle) * distance
    const fall = 140 + Math.random() * 160
    const spin = (Math.random() - 0.5) * 900
    const duration = 900 + Math.random() * 600
    piece
      .animate(
        [
          { transform: `translate(${x}px, ${y}px) rotate(0deg)`, opacity: 1 },
          { transform: `translate(${x + dx}px, ${y + dy}px) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.45 },
          { transform: `translate(${x + dx * 1.2}px, ${y + dy + fall}px) rotate(${spin}deg)`, opacity: 0 },
        ],
        { duration, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' },
      )
      .finished.catch(() => {})
      .finally(() => piece.remove())
  }
}
