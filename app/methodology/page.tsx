import Link from 'next/link'
import {
  CLUSTERING_VERSION,
  OUTLET_LIST_VERSION,
  RULE_VERSION,
  THRESHOLD_N,
  WINDOW_HOURS,
} from '@/app/lib/newsThreshold'
import { NEWS_OUTLETS } from '@/app/lib/newsFeeds/outlets'

export default function MethodologyPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <header
        style={{
          background: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border-subtle)',
          padding: '0 16px',
          height: '48px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        <Link
          href="/"
          style={{
            fontWeight: 700,
            fontSize: '1.1rem',
            color: 'var(--color-text-primary)',
            textDecoration: 'none',
          }}
        >
          GenPop
        </Link>
        <span style={{ color: 'var(--color-border-subtle)' }}>/</span>
        <span style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
          Methodology
        </span>
      </header>

      <main
        style={{
          maxWidth: '720px',
          margin: '0 auto',
          padding: '32px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '28px',
          color: 'var(--color-text-primary)',
        }}
      >
        <section>
          <h1 style={{ margin: '0 0 8px', fontSize: '1.6rem' }}>News threshold methodology</h1>
          <p style={{ margin: 0, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
            A story becomes a live card only when it clears a published cross-spectrum
            threshold. Lean labels come from AllSides Media Bias Chart™ ratings (retrieved
            2026-07-06), not GenPop&apos;s editorial judgment. Rule version{' '}
            <code>{RULE_VERSION}</code> · clustering <code>{CLUSTERING_VERSION}</code> · outlet
            list <code>{OUTLET_LIST_VERSION}</code>.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 8px' }}>The rule</h2>
          <p style={{ margin: 0, lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>
            Promote when <strong>N = {THRESHOLD_N}</strong> distinct outlets cover the same story
            within <strong>{WINDOW_HOURS} hours</strong>, spanning all three buckets (left, center,
            right). Each outlet counts once. Wire syndications collapse to the wire outlet.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 12px' }}>Outlet list</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {NEWS_OUTLETS.map((o) => (
              <div
                key={o.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 80px',
                  gap: '8px',
                  fontSize: '0.88rem',
                  paddingBottom: '8px',
                  borderBottom: '1px solid var(--color-border-subtle)',
                }}
              >
                <span>{o.name}</span>
                <span style={{ color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
                  {o.bucket}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 8px' }}>Change log</h2>
          <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--color-text-secondary)' }}>
            2026-07-06 — Initial published list (12 outlets, 4 per bucket). AP moved to Left per
            current AllSides rating; Guardian dropped; Dispatch and Washington Examiner added.
          </p>
        </section>
      </main>
    </div>
  )
}
