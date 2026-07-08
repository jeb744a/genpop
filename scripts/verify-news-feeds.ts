/**
 * Step 1 launch gate — feed verification harness (SPEC_news_threshold.md §1.2, §8.1).
 * Run: npx tsx scripts/verify-news-feeds.ts
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { formatVerifyTable, verifyAllNewsFeeds } from '../app/lib/newsFeeds/verify'
import { newsFeedUserAgent } from '../app/lib/newsFeeds/userAgent'

function loadEnv() {
  const envPath = resolve(process.cwd(), '.env.local')
  try {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/)
      if (m) process.env[m[1].trim()] = m[2].trim()
    }
  } catch {
    // optional for harness
  }
}

loadEnv()

async function main() {
  console.log('GenPop news feed verification harness')
  console.log('User-Agent:', newsFeedUserAgent())

  const report = await verifyAllNewsFeeds()
  console.log(formatVerifyTable(report))

  if (!report.all_buckets_ok) {
    console.error('LAUNCH BLOCKED: not all buckets have ≥1 working feed.')
    process.exit(1)
  }

  console.log('All three buckets have ≥1 working feed.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
