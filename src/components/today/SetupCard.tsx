import { useState, type ReactNode } from 'react'
import { Check, Copy, Database, ExternalLink, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button, buttonClass } from '@/components/ui'
import sql from '../../../supabase/migrations/20261018000000_planner.sql?raw'

/** Supabase dashboard link for a new SQL query in this project (generic dashboard if the URL is unknown). */
function sqlEditorUrl(): string {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  if (url) {
    try {
      const ref = new URL(url).hostname.split('.')[0]
      if (ref) return `https://supabase.com/dashboard/project/${encodeURIComponent(ref)}/sql/new`
    } catch {
      // Malformed URL: fall through to the generic dashboard.
    }
  }
  return 'https://supabase.com/dashboard'
}

/**
 * One-time setup, shown by TodayPage when the cloud database doesn't have the planner table yet.
 * Copy the migration, run it in the Supabase SQL editor, reload.
 */
export function SetupCard() {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sql)
      setCopied(true)
      toast.success('SQL copied')
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Couldn't copy. Open “Show the SQL” below and copy it by hand.")
    }
  }

  return (
    <section
      aria-labelledby="planner-setup-title"
      className="animate-fade-up rounded-2xl border border-line bg-card p-4 shadow-xs sm:p-5"
    >
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <Database className="size-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2 id="planner-setup-title" className="text-base font-semibold tracking-tight">
            One-time setup
          </h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            The planner needs a new table in your Supabase database (about 30 seconds).
          </p>
        </div>
      </div>

      <ol className="mt-4 space-y-3">
        <Step n={1} text="Copy the setup SQL.">
          <Button variant="primary" size="sm" onClick={() => void copy()}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? 'Copied' : 'Copy SQL'}
          </Button>
        </Step>
        <Step n={2} text="Open a new query in the Supabase SQL editor.">
          <a href={sqlEditorUrl()} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 'sm')}>
            <ExternalLink aria-hidden />
            Open Supabase SQL editor
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </Step>
        <Step n={3} text="Paste, press Run, then come back and Reload.">
          <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
            <RefreshCw aria-hidden />
            Reload
          </Button>
        </Step>
      </ol>

      <details className="group mt-4 rounded-xl border border-line bg-sunken">
        <summary className="cursor-pointer rounded-xl px-3 py-2 text-sm font-medium text-ink-muted select-none hover:text-ink">
          Show the SQL
        </summary>
        <pre className="max-h-72 overflow-auto border-t border-line px-3 py-2 font-mono text-xs leading-relaxed text-ink">
          <code>{sql}</code>
        </pre>
      </details>
    </section>
  )
}

function Step({ n, text, children }: { n: number; text: string; children: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span
        className="grid size-6 shrink-0 place-items-center rounded-full bg-sunken text-xs font-semibold text-ink-muted"
        aria-hidden
      >
        {n}
      </span>
      <span className="min-w-0 flex-1 basis-48 text-sm text-ink">{text}</span>
      <span className="ml-9 sm:ml-0">{children}</span>
    </li>
  )
}
