import { HOUR_CATEGORY_LABEL, type HourCategory } from '@/domain/plan'
import { cn } from '@/lib/cn'
import type { ParsedHour } from '@/lib/hours'

/**
 * Fill per category: solid -700 shades, so white text stays at about 5:1 in both themes. The
 * order (study, phone, sleep, food, build, chores, leisure) passes the dataviz palette validator's
 * normal-vision floor; the closest colour-blind pair (study/phone) sits in the 6-8 band, which is
 * allowed because colour is never the only cue: every cell, chip and bar also carries the
 * category's initial or name. Other is a neutral gray on purpose, and named Other hours
 * ("Gym") share it, told apart by their own initial and name.
 */
export const CATEGORY_FILL: Record<HourCategory, string> = {
  study: 'bg-emerald-700',
  phone: 'bg-rose-700',
  sleep: 'bg-indigo-700',
  food: 'bg-yellow-700',
  build: 'bg-purple-700',
  chores: 'bg-sky-700',
  leisure: 'bg-orange-700',
  other: 'bg-zinc-600',
}

/** One letter per category. Sleep is Z (S is Study). */
export const CATEGORY_INITIAL: Record<HourCategory, string> = {
  study: 'S',
  phone: 'P',
  sleep: 'Z',
  food: 'F',
  build: 'B',
  chores: 'C',
  leisure: 'L',
  other: 'O',
}

/** Short names for chips and summaries ("Phone 4h", not "Phone / random 4h"). */
export const SHORT_LABEL: Record<HourCategory, string> = { ...HOUR_CATEGORY_LABEL, phone: 'Phone' }

export const initialOf = (parsed: ParsedHour) => (parsed.tag ? parsed.tag.charAt(0).toUpperCase() : CATEGORY_INITIAL[parsed.category])

/** The colour swatch with its initial, as in the hour cells. Decorative: a name sits beside it. */
export function CategoryBadge({ parsed, className }: { parsed: ParsedHour; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-grid shrink-0 place-items-center text-[10px] leading-none font-bold text-white', CATEGORY_FILL[parsed.category], className)}
    >
      {initialOf(parsed)}
    </span>
  )
}

/** "4a", "12p". */
export function shortHour(h: number): string {
  return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'a' : 'p'}`
}

/** "4 AM", "12 PM". */
export function longHour(h: number): string {
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
