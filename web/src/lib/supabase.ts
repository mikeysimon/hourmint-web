import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseUrlMissing = !supabaseUrl || !supabaseAnonKey

export const supabase = createClient(supabaseUrl ?? 'https://missing-project.supabase.co', supabaseAnonKey ?? 'missing-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: 'hourmint-long-session',
  },
})
