import { useEffect, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router'
import { Toaster } from 'sonner'
import { AuthProvider, useAuth, useUser } from '@/auth/AuthProvider'
import { AppHeader } from '@/components/AppHeader'
import { LocalModeBanner } from '@/components/LocalModeBanner'
import { FocusAlarm } from '@/components/today/FocusAlarm'
import { Splash } from '@/components/ui'
import { AuthPage, ForgotPasswordPage, ResetPasswordPage } from '@/pages/AuthPages'
import { BoardPage } from '@/pages/BoardPage'
import { FocusPage } from '@/pages/FocusPage'
import { HistoryPage } from '@/pages/HistoryPage'
import { RulesPage } from '@/pages/RulesPage'
import { ShutdownPage } from '@/pages/ShutdownPage'
import { TodayPage } from '@/pages/TodayPage'
import { DumpsProvider } from '@/state/DumpsProvider'
import { PlannerProvider } from '@/state/PlannerProvider'
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider'

const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth()
  const location = useLocation()
  if (!ready) return <Splash />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return children
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth()
  const location = useLocation()
  if (!ready) return <Splash />
  if (user) {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from && from !== '/login' && from !== '/signup' ? from : '/'} replace />
  }
  return children
}

/** After a password-recovery link signs the user in, keep them on the reset form until they're done. */
function RecoveryRedirect() {
  const { recovery } = useAuth()
  const { pathname } = useLocation()
  if (recovery && pathname !== '/reset-password') return <Navigate to="/reset-password" replace />
  return null
}

function AppLayout() {
  const user = useUser()
  return (
    // Keyed by user so nothing from a previous account survives a sign-in switch.
    <DumpsProvider key={user.id} userId={user.id}>
      <PlannerProvider userId={user.id}>
        <MorningLanding />
        <FocusAlarm />
        <div className="flex min-h-dvh flex-col">
          <AppHeader />
          <LocalModeBanner />
          <Outlet />
        </div>
      </PlannerProvider>
    </DumpsProvider>
  )
}

/**
 * Before noon, opening the app lands on Today instead of the board (once per browser session),
 * so the morning starts from the queue, not from the pile of thoughts.
 */
function MorningLanding() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    try {
      if (sessionStorage.getItem('minddump:landed')) return
      sessionStorage.setItem('minddump:landed', '1')
    } catch {
      return
    }
    if (pathname === '/' && new Date().getHours() < 12) navigate('/today', { replace: true })
    // Only on the first render of a session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

function ThemedToaster() {
  const { resolved } = useTheme()
  return (
    <Toaster
      theme={resolved}
      position="bottom-center"
      richColors
      closeButton
      duration={5000}
      offset={{ bottom: 'max(16px, env(safe-area-inset-bottom))' }}
      mobileOffset={{ bottom: 'max(12px, env(safe-area-inset-bottom))' }}
    />
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter basename={basename}>
          <RecoveryRedirect />
          <Routes>
            <Route path="/login" element={<PublicOnly><AuthPage mode="login" /></PublicOnly>} />
            <Route path="/signup" element={<PublicOnly><AuthPage mode="signup" /></PublicOnly>} />
            <Route path="/forgot-password" element={<PublicOnly><ForgotPasswordPage /></PublicOnly>} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
              <Route index element={<BoardPage />} />
              <Route path="today" element={<TodayPage />} />
              <Route path="focus" element={<FocusPage />} />
              <Route path="shutdown" element={<ShutdownPage />} />
              <Route path="rules" element={<RulesPage />} />
              <Route path="history" element={<HistoryPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <ThemedToaster />
      </AuthProvider>
    </ThemeProvider>
  )
}
