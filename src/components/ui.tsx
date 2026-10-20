import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { Eye, EyeOff, LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/cn'

// ---- Button ----------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost'
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

const variants: Record<Variant, string> = {
  primary:
    'bg-accent-solid bg-linear-to-r from-accent-from to-accent-to text-accent-ink shadow-md shadow-accent/25 hover:brightness-110 hover:shadow-lg hover:shadow-accent/30',
  secondary: 'border border-line bg-card text-ink shadow-xs hover:border-line-strong hover:bg-sunken',
  ghost: 'text-ink-muted hover:bg-sunken hover:text-ink',
  danger: 'bg-danger-solid text-white shadow-sm hover:brightness-95',
  'danger-ghost': 'text-danger hover:bg-danger-soft',
}

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-xl',
  icon: 'h-10 w-10 rounded-xl',
  'icon-sm': 'h-8 w-8 rounded-lg',
}

export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas'

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', className?: string) {
  return cn(
    'inline-flex shrink-0 select-none items-center justify-center font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,filter] duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
    focusRing,
    variants[variant],
    sizes[size],
    className,
  )
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

export function Button({ variant, size, loading, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} {...rest}>
      {loading && <LoaderCircle className="animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

// ---- Logo ------------------------------------------------------------------

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('size-8 shrink-0', className)} aria-hidden>
      <defs>
        <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7c5cff" />
          <stop offset="1" stopColor="#d946ef" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#logo-g)" />
      <rect x="14" y="16" width="16" height="14" rx="4" fill="#fff" />
      <rect x="34" y="16" width="16" height="14" rx="4" fill="#fff" opacity=".7" />
      <rect x="14" y="34" width="16" height="14" rx="4" fill="#fff" opacity=".7" />
      <rect x="34" y="34" width="16" height="14" rx="4" fill="#fff" opacity=".4" />
    </svg>
  )
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="text-[17px] font-semibold tracking-tight">Mind Dump</span>
    </span>
  )
}

// ---- Fields ----------------------------------------------------------------

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string
  error?: string
  hint?: ReactNode
  trailing?: ReactNode
}

export function TextField({ label, error, hint, trailing, className, id, ...rest }: TextFieldProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined
  return (
    <div className={className}>
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'h-11 w-full rounded-xl border bg-card px-3.5 text-base text-ink sm:text-[15px] shadow-xs transition placeholder:text-ink-subtle',
            'focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15',
            error ? 'border-danger' : 'border-line hover:border-line-strong',
            trailing ? 'pr-11' : undefined,
          )}
          {...rest}
        />
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>
      {error ? (
        <p id={`${inputId}-error`} className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1.5 text-xs text-ink-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function PasswordField(props: Omit<TextFieldProps, 'type' | 'trailing'>) {
  const [visible, setVisible] = useState(false)
  return (
    <TextField
      {...props}
      type={visible ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className={cn('grid size-9 place-items-center rounded-lg text-ink-subtle hover:text-ink', focusRing)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      }
    />
  )
}

// ---- Modal (native <dialog>: focus trap, Escape, top layer for free) --------

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  className?: string
}

export function Modal({ open, onClose, title, description, children, footer, className }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descId = useId()
  // Only a press that *starts* on the backdrop closes — a text selection dragged out of the
  // textarea and released on the backdrop must not discard edits.
  const pressedBackdrop = useRef(false)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === ref.current
      }}
      onClick={(e) => {
        if (pressedBackdrop.current && e.target === ref.current) onClose()
        pressedBackdrop.current = false
      }}
      className={cn(
        'm-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-line bg-elevated p-0 text-ink shadow-2xl',
        'max-sm:mb-0 max-sm:max-h-[calc(100dvh-env(safe-area-inset-top)-0.5rem)] max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none max-sm:border-b-0',
        open && 'animate-fade-up',
        className,
      )}
    >
      {open && (
        <div className="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-6">
          <h2 id={titleId} className="text-lg font-semibold tracking-tight">
            {title}
          </h2>
          {description && (
            <div id={descId} className="mt-1 text-sm text-ink-muted">
              {description}
            </div>
          )}
          {children && <div className="mt-4">{children}</div>}
          {footer && <div className="mt-5 flex flex-wrap items-center justify-end gap-2">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDialog({ open, title, description, confirmLabel, onConfirm, onClose }: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  )
}

// ---- Misc ------------------------------------------------------------------

export function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center" role="status" aria-label="Loading">
      <LogoMark className="size-12 animate-pulse" />
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="animate-fade-up mx-auto flex max-w-sm flex-col items-center px-4 py-16 text-center">
      <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent [&_svg]:size-7">{icon}</div>
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1.5 text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-md border border-line bg-sunken px-1.5 py-px font-sans text-[11px] font-medium text-ink-muted">
      {children}
    </kbd>
  )
}
