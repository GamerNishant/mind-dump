import { useLayoutEffect, useMemo, useState, type FormEvent, type KeyboardEvent, type Ref, type RefObject } from 'react'
import { ListPlus, Plus } from 'lucide-react'
import { MAX_DUMP_LENGTH } from '@/domain/dump'
import { cn } from '@/lib/cn'
import { splitLines } from '@/lib/text'
import { Button, Kbd } from './ui'

const isCoarsePointer = () => window.matchMedia('(pointer: coarse)').matches

interface ComposerProps {
  inputRef: RefObject<HTMLTextAreaElement | null>
  onSubmit: (items: string[]) => Promise<boolean>
}

export function Composer({ inputRef, onSubmit }: ComposerProps) {
  const [value, setValue] = useState('')
  const lines = useMemo(() => splitLines(value), [value])
  const canSubmit = value.trim().length > 0
  const nearLimit = value.length > MAX_DUMP_LENGTH * 0.8

  // Grow with content, up to a cap.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [value, inputRef])

  const submit = async (split: boolean) => {
    const text = value
    if (!text.trim()) return
    setValue('')
    inputRef.current?.focus()
    const ok = await onSubmit(split ? splitLines(text) : [text])
    // Give the text back if saving failed and the user hasn't started typing something new.
    if (!ok) setValue((current) => current || text)
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    void submit(false)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault()
      void submit(lines.length > 1)
      return
    }
    // On touch keyboards Enter makes a new line; the Dump button submits.
    if (!e.shiftKey && !isCoarsePointer()) {
      e.preventDefault()
      void submit(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        'rounded-2xl border border-line bg-card shadow-sm transition',
        'focus-within:border-accent/60 focus-within:shadow-md focus-within:ring-4 focus-within:ring-accent/10',
      )}
    >
      <label htmlFor="composer" className="sr-only">
        New dump
      </label>
      <textarea
        id="composer"
        ref={inputRef as Ref<HTMLTextAreaElement>}
        rows={1}
        value={value}
        maxLength={MAX_DUMP_LENGTH}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="What's on your mind? Dump it here…"
        enterKeyHint="enter"
        className="block max-h-60 min-h-14 w-full resize-none bg-transparent px-4 pt-4 pb-1 text-base leading-relaxed text-ink placeholder:text-ink-subtle focus:outline-none sm:text-[15px]"
      />
      <div className="flex items-center gap-2 px-3 pt-1 pb-3">
        <p className="hidden items-center gap-1.5 pl-1 text-xs text-ink-subtle sm:pointer-fine:flex">
          <Kbd>Enter</Kbd> to dump <span aria-hidden>·</span> <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> new line
        </p>
        <div className="ml-auto flex items-center gap-2">
          {nearLimit && (
            <span className="text-xs text-ink-subtle tabular-nums" aria-live="polite">
              {value.length}/{MAX_DUMP_LENGTH}
            </span>
          )}
          {lines.length > 1 && (
            <Button variant="secondary" size="sm" onClick={() => void submit(true)} title="One tile per line (Ctrl+Enter)">
              <ListPlus aria-hidden />
              Split into {lines.length}
            </Button>
          )}
          <Button type="submit" size="sm" disabled={!canSubmit} className="px-3.5">
            <Plus aria-hidden />
            Dump
          </Button>
        </div>
      </div>
    </form>
  )
}
