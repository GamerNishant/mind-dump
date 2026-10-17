import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowLeft, Clock, HardDrive, MailCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/auth/AuthProvider'
import { Button, focusRing, Logo, LogoMark, PasswordField, Splash, TextField } from '@/components/ui'
import { errorMessage } from '@/data/errors'
import { cn } from '@/lib/cn'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD = 8

// ---- Layout ------------------------------------------------------------------

const sampleTiles = [
  { text: 'Book the dentist appointment', days: '9 days', tone: 'bg-orange-400', rotate: '-rotate-3' },
  { text: 'Idea: weekend hike with Sam', days: 'Today', tone: 'bg-emerald-400', rotate: 'rotate-2' },
  { text: 'Renew passport before March', days: '3 days', tone: 'bg-amber-400', rotate: '-rotate-1' },
]

function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  const { backendKind } = useAuth()
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-[#1d1442] via-[#3b23a8] to-[#a21caf] p-12 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -top-24 -right-24 size-96 rounded-full bg-fuchsia-400/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 size-96 rounded-full bg-indigo-400/30 blur-3xl" />
        <Logo className="relative" />
        <div className="relative my-auto max-w-md">
          <h2 className="text-4xl leading-[1.15] font-semibold tracking-tight">
            Empty your head.
            <br />
            Keep your focus.
          </h2>
          <p className="mt-4 text-lg text-white/75">
            Every thought becomes a tile. Clear it when it's handled, and see how long the rest have been waiting.
          </p>
          <div className="mt-10 grid grid-cols-2 gap-4" aria-hidden>
            {sampleTiles.map((t, i) => (
              <div
                key={t.text}
                className={cn(
                  'relative rounded-2xl bg-white/95 p-4 pl-5 text-ink shadow-2xl shadow-black/30',
                  t.rotate,
                  i === 2 && 'col-span-2 mx-8',
                )}
              >
                <span className={cn('absolute inset-y-3 left-0 w-[3px] rounded-r-full', t.tone)} />
                <p className="text-[15px] leading-snug text-zinc-900">{t.text}</p>
                <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                  <Clock className="size-3" />
                  {t.days}
                </span>
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-sm text-white/60">Free, private, and synced across your devices.</p>
      </aside>

      <main className="flex items-center justify-center px-4 py-10 sm:px-6">
        <div className="animate-fade-up w-full max-w-sm">
          <LogoMark className="mb-6 size-11 lg:hidden" />
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-[15px] text-ink-muted">{subtitle}</p>}
          <div className="mt-7">{children}</div>
          {backendKind === 'local' && (
            <p className="mt-8 flex gap-2 rounded-xl bg-sunken p-3 text-xs text-ink-muted">
              <HardDrive className="mt-px size-3.5 shrink-0" aria-hidden />
              Device-only mode: accounts and dumps are stored in this browser.
            </p>
          )}
        </div>
      </main>
    </div>
  )
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
      {message}
    </div>
  )
}

const linkClass = cn('font-medium text-accent hover:underline underline-offset-4 rounded', focusRing)

// ---- Sign in / Sign up --------------------------------------------------------

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const { auth } = useAuth()
  const isSignup = mode === 'signup'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Partial<Record<'name' | 'email' | 'password', string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmSentTo, setConfirmSentTo] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const validate = () => {
    const next: typeof errors = {}
    if (isSignup && !name.trim()) next.name = 'Tell us what to call you.'
    if (!EMAIL_RE.test(email.trim())) next.email = 'Enter a valid email address.'
    if (isSignup ? password.length < MIN_PASSWORD : !password) {
      next.password = isSignup ? `Use at least ${MIN_PASSWORD} characters.` : 'Enter your password.'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (!validate()) {
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus())
      return
    }
    setSubmitting(true)
    try {
      if (isSignup) {
        const result = await auth.signUp({ email, password, displayName: name })
        if (result === 'confirm-email') setConfirmSentTo(email.trim())
      } else {
        await auth.signIn(email, password)
      }
      // On success the auth listener updates the user and the route guard redirects.
    } catch (error) {
      setFormError(errorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  if (confirmSentTo) {
    return (
      <AuthLayout title="Check your inbox" subtitle={<>We sent a confirmation link to <strong className="text-ink">{confirmSentTo}</strong>.</>}>
        <div className="flex items-start gap-3 rounded-2xl border border-line bg-card p-4 text-sm text-ink-muted">
          <MailCheck className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
          <p>Open the link in that email to activate your account, then come back and sign in. Check spam if you don't see it.</p>
        </div>
        <Link to="/login" className={cn('mt-6 inline-block text-sm', linkClass)}>
          Back to sign in
        </Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title={isSignup ? 'Create your account' : 'Welcome back'}
      subtitle={isSignup ? 'Start clearing your head in seconds.' : 'Sign in to see your dumps.'}
    >
      <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={formError} />
        {isSignup && (
          <TextField
            label="Name"
            name="name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
            maxLength={50}
          />
        )}
        <TextField
          label="Email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <div>
          <PasswordField
            label="Password"
            name="password"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            hint={isSignup ? `At least ${MIN_PASSWORD} characters.` : undefined}
          />
          {!isSignup && (
            <div className="mt-2 text-right">
              <Link to="/forgot-password" className={cn('text-sm', linkClass)}>
                Forgot password?
              </Link>
            </div>
          )}
        </div>
        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          {isSignup ? 'Create account' : 'Sign in'}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-muted">
        {isSignup ? 'Already have an account? ' : 'New here? '}
        <Link to={isSignup ? '/login' : '/signup'} className={linkClass}>
          {isSignup ? 'Sign in' : 'Create an account'}
        </Link>
      </p>
    </AuthLayout>
  )
}

// ---- Forgot password ------------------------------------------------------------

export function ForgotPasswordPage() {
  const { auth } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!EMAIL_RE.test(email.trim())) return setError('Enter a valid email address.')
    setSubmitting(true)
    try {
      await auth.requestPasswordReset(email)
      setSent(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  const back = (
    <Link to="/login" className={cn('mt-6 inline-flex items-center gap-1.5 text-sm', linkClass)}>
      <ArrowLeft className="size-4" aria-hidden /> Back to sign in
    </Link>
  )

  if (!auth.supportsPasswordReset) {
    return (
      <AuthLayout title="Reset password" subtitle="Password reset emails need the cloud backend, which isn't connected yet.">
        {back}
      </AuthLayout>
    )
  }

  if (sent) {
    return (
      <AuthLayout title="Check your inbox" subtitle={<>If an account exists for <strong className="text-ink">{email.trim()}</strong>, a reset link is on its way.</>}>
        {back}
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Reset password" subtitle="We'll email you a link to choose a new one.">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={error} />
        <TextField label="Email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          Send reset link
        </Button>
      </form>
      {back}
    </AuthLayout>
  )
}

// ---- Reset password (landing page from the email link) ----------------------------

export function ResetPasswordPage() {
  const { auth, user, ready, clearRecovery } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const hash = new URLSearchParams(window.location.hash.slice(1))
  const processingLink = hash.has('access_token') && !user
  if (!ready || processingLink) return <Splash />

  if (!user) {
    const reason = hash.get('error_description') ?? new URLSearchParams(window.location.search).get('error_description')
    return (
      <AuthLayout title="Link expired" subtitle={reason ?? 'This reset link is invalid or has expired. Request a new one.'}>
        <Link to="/forgot-password" className={cn('text-sm', linkClass)}>
          Send a new link
        </Link>
      </AuthLayout>
    )
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`)
    if (password !== confirm) return setError("Passwords don't match.")
    setSubmitting(true)
    try {
      await auth.updatePassword(password)
      clearRecovery()
      toast.success('Password updated')
      navigate('/', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout title="Choose a new password" subtitle={<>For {user.email}</>}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={error} />
        <PasswordField label="New password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <PasswordField label="Confirm new password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          Update password
        </Button>
      </form>
    </AuthLayout>
  )
}
