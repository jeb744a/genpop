import { notFound } from 'next/navigation'
import Link from 'next/link'
import { fetchCardById } from '@/app/lib/cards/queries'
import { getStatusStyle } from '@/app/components/Card'
import { InsightPanel } from '@/app/components/InsightPanel'
import { LiveNewsMeta } from '@/app/components/LiveNewsMeta'
import type { CardDetail } from '@/app/lib/cards/types'

// ── Date formatting ───────────────────────────────────────────────────

function formatDate(ts: string | null | undefined): string {
  if (!ts) return '—'
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(ts))
}

// ── Per-type derived fields from raw ─────────────────────────────────

function LegislativeDetail({ card }: { card: CardDetail }) {
  const raw = card.raw

  if (card.source === 'congress') {
    // raw = BillDetail + textVersions (see congress/ingest.ts)
    const sponsors = raw.sponsors as Array<{
      fullName?: string
      party?: string
      state?: string
    }> | undefined
    const latestAction = raw.latestAction as { actionDate?: string; text?: string } | undefined
    const laws = raw.laws as Array<{ type?: string; number?: string }> | undefined
    const billType = typeof raw.type === 'string' ? raw.type : ''
    const billNumber = typeof raw.number === 'string' ? raw.number : ''
    const congress = typeof raw.congress === 'number' ? raw.congress : ''

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {(billType || billNumber) && (
          <DetailRow label="Bill">
            {`${billType} ${billNumber}${congress ? ` · ${congress}th Congress` : ''}`}
          </DetailRow>
        )}
        {sponsors?.[0] && (
          <DetailRow label="Sponsor">
            {`${sponsors[0].fullName ?? ''}${sponsors[0].party ? ` (${sponsors[0].party}` : ''}${sponsors[0].state ? `-${sponsors[0].state})` : ''}`}
          </DetailRow>
        )}
        {latestAction?.text && (
          <DetailRow label="Latest Action">
            {latestAction.text}
            {latestAction.actionDate && (
              <span style={{ color: 'var(--color-text-secondary)', marginLeft: '8px' }}>
                {formatDate(latestAction.actionDate)}
              </span>
            )}
          </DetailRow>
        )}
        {laws?.[0] && (
          <DetailRow label="Law">
            {`${laws[0].type ?? ''} ${laws[0].number ?? ''}`.trim()}
          </DetailRow>
        )}
      </div>
    )
  }

  // legiscan: raw = LegiScan Bill object
  const billNumber = typeof raw.bill_number === 'string' ? raw.bill_number : ''
  const sponsors = raw.sponsors as Array<{ name?: string; party?: string; role?: string }> | undefined
  const history = raw.history as Array<{ date?: string; action?: string; chamber?: string }> | undefined
  const recentHistory = history?.filter((h) => h.date && h.date !== '0000-00-00').slice(-3).reverse()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {billNumber && <DetailRow label="Bill Number">{billNumber}</DetailRow>}
      {sponsors?.[0]?.name && (
        <DetailRow label="Sponsor">
          {`${sponsors[0].name}${sponsors[0].party ? ` (${sponsors[0].party})` : ''}`}
        </DetailRow>
      )}
      {recentHistory && recentHistory.length > 0 && (
        <div>
          <dt
            style={{
              fontSize: '0.72rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--color-text-secondary)',
              marginBottom: '6px',
            }}
          >
            Recent Actions
          </dt>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {recentHistory.map((h, i) => (
              <div
                key={i}
                style={{
                  fontSize: '0.82rem',
                  color: 'var(--color-text-primary)',
                  display: 'flex',
                  gap: '12px',
                }}
              >
                <span style={{ color: 'var(--color-text-secondary)', minWidth: '90px' }}>
                  {formatDate(h.date ?? null)}
                </span>
                <span>{h.action}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ExecutiveDetail({ card }: { card: CardDetail }) {
  const raw = card.raw
  const eoNumber = typeof raw.executive_order_number === 'string' ? raw.executive_order_number : null
  const president = (raw.president as { name?: string } | null)?.name ?? null
  const agencies = raw.agencies as Array<{ name?: string }> | undefined
  const subtype = typeof raw.subtype === 'string' ? raw.subtype : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {subtype && <DetailRow label="Type">{subtype}</DetailRow>}
      {eoNumber && <DetailRow label="Executive Order">{eoNumber}</DetailRow>}
      {president && <DetailRow label="President">{president}</DetailRow>}
      {agencies?.[0]?.name && <DetailRow label="Agency">{agencies[0].name!}</DetailRow>}
    </div>
  )
}

function JudicialDetail({ card }: { card: CardDetail }) {
  const raw = card.raw
  const docketNumber = typeof raw.docket_number === 'string' ? raw.docket_number : null
  const courtId = typeof raw.court_id === 'string' ? raw.court_id : null
  const dateFiled = typeof raw.date_filed === 'string' ? raw.date_filed : null
  const dateArgued = typeof raw.date_argued === 'string' ? raw.date_argued : null
  const dateTerminated = typeof raw.date_terminated === 'string' ? raw.date_terminated : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {docketNumber && <DetailRow label="Docket">{docketNumber}</DetailRow>}
      {courtId && <DetailRow label="Court">{courtId.toUpperCase()}</DetailRow>}
      {dateFiled && <DetailRow label="Filed">{formatDate(dateFiled)}</DetailRow>}
      {dateArgued && <DetailRow label="Argued">{formatDate(dateArgued)}</DetailRow>}
      {dateTerminated && <DetailRow label="Terminated">{formatDate(dateTerminated)}</DetailRow>}
    </div>
  )
}

// ── Shared row component ──────────────────────────────────────────────

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
      <dt
        style={{
          fontSize: '0.72rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--color-text-secondary)',
          minWidth: '90px',
          paddingTop: '1px',
        }}
      >
        {label}
      </dt>
      <dd
        style={{
          margin: 0,
          fontSize: '0.88rem',
          color: 'var(--color-text-primary)',
          flex: 1,
        }}
      >
        {children}
      </dd>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────

export default async function CardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const card = await fetchCardById(id)
  if (!card) notFound()

  const statusStyle = getStatusStyle(card.status)

  const typeLabel =
    card.card_type === 'legislative'
      ? 'Legislative'
      : card.card_type === 'executive'
        ? 'Executive'
        : card.card_type === 'judicial'
          ? 'Judicial'
          : card.card_type === 'live'
            ? 'Live'
            : card.card_type

  const sphereLabel =
    card.card_type === 'live'
      ? 'News'
      : card.sphere === 'state' && card.region
        ? card.region
        : card.sphere === 'federal'
          ? 'Federal'
          : card.sphere

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
          gap: '12px',
        }}
      >
        <Link
          href="/"
          style={{
            fontWeight: 700,
            fontSize: '1.1rem',
            letterSpacing: '-0.02em',
            color: 'var(--color-text-primary)',
            textDecoration: 'none',
          }}
        >
          GenPop
        </Link>
        <span style={{ color: 'var(--color-border-subtle)' }}>/</span>
        <Link
          href="/"
          style={{
            fontSize: '0.85rem',
            color: 'var(--color-text-secondary)',
            textDecoration: 'none',
          }}
        >
          Feed
        </Link>
      </header>

      <main
        style={{
          maxWidth: '720px',
          margin: '0 auto',
          padding: '24px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
        }}
      >
        {/* Header */}
        <section>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: '0.72rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--color-text-secondary)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: '999px',
                padding: '2px 8px',
              }}
            >
              {typeLabel}
            </span>
            <span style={{ color: statusStyle.color, fontSize: '0.82rem', fontWeight: 500 }}>
              {statusStyle.label}
            </span>
            <span
              style={{
                marginLeft: 'auto',
                fontSize: '0.78rem',
                color: 'var(--color-text-secondary)',
              }}
            >
              {sphereLabel}
            </span>
          </div>

          <h1
            style={{
              margin: 0,
              fontSize: '1.3rem',
              fontWeight: 700,
              lineHeight: 1.35,
              color: 'var(--color-text-primary)',
            }}
          >
            {card.title}
          </h1>
        </section>

        {/* Key dates */}
        <section
          style={{
            background: 'var(--color-surface)',
            borderRadius: '8px',
            border: '1px solid var(--color-border-subtle)',
            padding: '16px',
          }}
        >
          <dl style={{ display: 'flex', flexDirection: 'column', gap: '10px', margin: 0 }}>
            {card.occurred_at && (
              <DetailRow
                label={
                  card.card_type === 'legislative'
                    ? 'Introduced'
                    : card.card_type === 'executive'
                      ? 'Signed'
                      : 'Filed'
                }
              >
                {formatDate(card.occurred_at)}
              </DetailRow>
            )}
            {card.last_action_at && (
              <DetailRow label="Last Action">{formatDate(card.last_action_at)}</DetailRow>
            )}
          </dl>
        </section>

        {/* Summary */}
        {card.summary && (
          <section
            style={{
              background: 'var(--color-surface)',
              borderRadius: '8px',
              border: '1px solid var(--color-border-subtle)',
              padding: '16px',
            }}
          >
            <h2
              style={{
                margin: '0 0 8px',
                fontSize: '0.8rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--color-text-secondary)',
              }}
            >
              Summary
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: '0.9rem',
                color: 'var(--color-text-primary)',
                lineHeight: 1.6,
              }}
            >
              {card.summary}
            </p>
          </section>
        )}

        {/* Per-type details — skip empty for live; show audit instead */}
        {card.card_type !== 'live' && (
          <section
            style={{
              background: 'var(--color-surface)',
              borderRadius: '8px',
              border: '1px solid var(--color-border-subtle)',
              padding: '16px',
            }}
          >
            <h2
              style={{
                margin: '0 0 12px',
                fontSize: '0.8rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--color-text-secondary)',
              }}
            >
              Details
            </h2>
            <dl style={{ margin: 0 }}>
              {card.card_type === 'legislative' && <LegislativeDetail card={card} />}
              {card.card_type === 'executive' && <ExecutiveDetail card={card} />}
              {card.card_type === 'judicial' && <JudicialDetail card={card} />}
            </dl>
          </section>
        )}

        {card.card_type === 'live' && card.news_audit && (
          <section
            style={{
              background: 'var(--color-surface)',
              borderRadius: '8px',
              border: '1px solid var(--color-border-subtle)',
              padding: '16px',
            }}
          >
            <h2
              style={{
                margin: '0 0 12px',
                fontSize: '0.8rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--color-text-secondary)',
              }}
            >
              Threshold audit
            </h2>
            <LiveNewsMeta audit={card.news_audit} status={card.status} />
          </section>
        )}

        {/* Source link */}
        {card.source_url && (
          <div>
            <a
              href={card.source_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: 'var(--color-accent)',
                fontSize: '0.88rem',
                fontWeight: 500,
                textDecoration: 'none',
              }}
            >
              View source →
            </a>
          </div>
        )}

        {/* AI Insight — legislative / executive / judicial only */}
        {card.card_type !== 'live' && <InsightPanel cardId={card.id} />}

        {/* ── Reactions & Discussion — Phase 6/7 ── */}
      </main>
    </div>
  )
}
