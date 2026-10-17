import { createLocalBackend } from './local/localBackend'
import { createSupabaseBackend } from './supabase/supabaseBackend'
import type { Backend } from './types'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

/** The app-wide backend: Supabase when configured, otherwise device-only storage. */
export const backend: Backend = url && key ? createSupabaseBackend(url, key) : createLocalBackend(window.localStorage)
