/** Single-line, length-capped version of a dump for toasts and labels. */
export function preview(content: string, max = 60): string {
  const single = content.replace(/\s+/g, ' ').trim()
  return single.length > max ? `${single.slice(0, max - 1)}…` : single
}

/** Split text into one entry per line, stripping list markers ("- ", "* ", "• ", "1. ", "[ ] "). */
export function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•–]|\d+[.)]|\[[ xX]?\])\s+/, '').trim())
    .filter(Boolean)
}
