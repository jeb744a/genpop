import { Suspense } from 'react'
import Card from '@/app/components/Card'
import CoverageBar from '@/app/components/CoverageBar'
import FeedControls from '@/app/components/FeedControls'
import { fetchFeedCards, PAGE_SIZE } from '@/app/lib/cards/queries'
import type { FeedParams, SortMode } from '@/app/lib/cards/types'

function parseParams(raw: Record<string, string | string[] | undefined>): FeedParams {
  const sort = (['recent', 'trending', 'passed'] as SortMode[]).includes(
    raw.sort as SortMode
  )
    ? (raw.sort as SortMode)
    : 'recent'

  const branches =
    typeof raw.branch === 'string'
      ? raw.branch.split(',').filter(Boolean)
      : []

  const spheres =
    typeof raw.sphere === 'string'
      ? raw.sphere.split(',').filter(Boolean)
      : []

  const page = Math.max(1, parseInt(typeof raw.page === 'string' ? raw.page : '1', 10) || 1)

  return { sort, branches, spheres, page }
}

function paginationUrl(
  params: FeedParams,
  targetPage: number,
  raw: Record<string, string | string[] | undefined>
): string {
  const sp = new URLSearchParams()
  if (params.sort !== 'recent') sp.set('sort', params.sort)
  if (params.branches.length > 0) sp.set('branch', params.branches.join(','))
  if (params.spheres.length > 0) sp.set('sphere', params.spheres.join(','))
  if (targetPage > 1) sp.set('page', String(targetPage))
  for (const [k, v] of Object.entries(raw)) {
    if (!['sort', 'branch', 'sphere', 'page'].includes(k) && typeof v === 'string') {
      sp.set(k, v)
    }
  }
  const qs = sp.toString()
  return qs ? `/?${qs}` : '/'
}

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const raw = await searchParams
  const params = parseParams(raw)
  const { cards, hasMore } = await fetchFeedCards(params)

  const linkStyle = {
    padding: '6px 18px',
    borderRadius: '6px',
    border: '1px solid var(--color-border-subtle)',
    background: 'var(--color-surface)',
    color: 'var(--color-text-primary)',
    fontSize: '0.85rem',
    textDecoration: 'none',
    fontWeight: 500,
  } as const

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      {/* Site header */}
      <header
        style={{
          background: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border-subtle)',
          padding: '0 16px',
          height: '48px',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <span
          style={{
            fontWeight: 700,
            fontSize: '1.1rem',
            letterSpacing: '-0.02em',
            color: 'var(--color-text-primary)',
          }}
        >
          GenPop
        </span>
      </header>

      <CoverageBar />

      {/* FeedControls is a client component; wrap in Suspense so the page
          can stream without waiting for useSearchParams hydration */}
      <Suspense fallback={null}>
        <FeedControls />
      </Suspense>

      {/* Feed */}
      <main
        style={{
          maxWidth: '720px',
          margin: '0 auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        {cards.length === 0 ? (
          <p
            style={{
              color: 'var(--color-text-secondary)',
              textAlign: 'center',
              marginTop: '48px',
            }}
          >
            No cards match the current filters.
          </p>
        ) : (
          cards.map((card) => <Card key={card.id} card={card} />)
        )}

        {/* Pagination */}
        {(params.page > 1 || hasMore) && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '8px',
              paddingTop: '16px',
              borderTop: '1px solid var(--color-border-subtle)',
            }}
          >
            {params.page > 1 ? (
              <a href={paginationUrl(params, params.page - 1, raw)} style={linkStyle}>
                ← Prev
              </a>
            ) : (
              <span />
            )}
            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
              Page {params.page}
            </span>
            {hasMore ? (
              <a href={paginationUrl(params, params.page + 1, raw)} style={linkStyle}>
                Next →
              </a>
            ) : (
              <span />
            )}
          </div>
        )}

        <p
          style={{
            fontSize: '0.72rem',
            color: 'var(--color-text-secondary)',
            textAlign: 'center',
            marginTop: '12px',
          }}
        >
          Showing {cards.length} of up to {PAGE_SIZE} per page
        </p>
      </main>
    </div>
  )
}
