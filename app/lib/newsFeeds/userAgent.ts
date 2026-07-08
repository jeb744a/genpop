/** User-Agent per SPEC_news_threshold.md §6.3 */
export function newsFeedUserAgent(): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://genpop.us'
  const base = site.replace(/\/$/, '')
  return `GenPopBot/1.0 (+${base}/methodology; news threshold ingest; contact: contact@genpop.us)`
}
