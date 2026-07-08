import { NextResponse } from 'next/server'
import { createClient } from '@/app/lib/supabase/server'
import { createAdminClient } from '@/app/lib/supabase/admin'
import { CONSECUTIVE_FAIL_ALARM } from '@/app/lib/newsThreshold'

const REQUIRED_ENV_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SITE_URL',
] as const

export async function GET() {
  const envChecks = Object.fromEntries(
    REQUIRED_ENV_VARS.map((key) => [key, Boolean(process.env[key])])
  ) as Record<(typeof REQUIRED_ENV_VARS)[number], boolean>

  const allEnvPresent = Object.values(envChecks).every(Boolean)

  let dbConnected = false
  let dbError: string | undefined

  try {
    const supabase = await createClient()
    const { error } = await supabase
      .from('cards')
      .select('*', { count: 'exact', head: true })

    if (error) {
      dbError = error.message
    } else {
      dbConnected = true
    }
  } catch (err) {
    dbError = err instanceof Error ? err.message : 'Unknown error'
  }

  let feedAlarms: Array<{
    outlet_id: string
    consecutive_fails: number
    last_status: number | null
  }> = []
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('news_feed_state')
      .select('outlet_id, consecutive_fails, last_status')
      .gte('consecutive_fails', CONSECUTIVE_FAIL_ALARM)
    feedAlarms = (data ?? []) as typeof feedAlarms
  } catch {
    // table may not exist yet
  }

  const ok = allEnvPresent && dbConnected && feedAlarms.length === 0

  return NextResponse.json(
    {
      ok,
      checks: {
        env: envChecks,
        db: {
          connected: dbConnected,
          ...(dbError ? { error: dbError } : {}),
        },
        news_feeds: {
          alarms: feedAlarms,
          threshold: CONSECUTIVE_FAIL_ALARM,
        },
      },
    },
    { status: ok ? 200 : 503 }
  )
}
