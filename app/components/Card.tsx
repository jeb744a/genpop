import Link from 'next/link'
import type { CardRow } from '@/app/lib/cards/types'
import { LiveNewsMeta } from '@/app/components/LiveNewsMeta'

// ── Status display ────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { label: string; color: string }> = {
  INTRODUCED:     { label: 'Introduced',          color: 'var(--status-default)' },
  PASSED_CHAMBER: { label: 'Passed Chamber',       color: 'var(--status-chamber)' },
  TO_PRESIDENT:   { label: 'To President',         color: 'var(--status-chamber)' },
  PASSED:         { label: 'Passed',               color: 'var(--status-passed)' },
  ENACTED:        { label: 'Enacted',              color: 'var(--status-enacted)' },
  VETOED:         { label: 'Vetoed',               color: 'var(--status-vetoed)' },
  FAILED:         { label: 'Failed',               color: 'var(--status-failed)' },
  EO_ISSUED:      { label: 'EO Issued',            color: 'var(--status-passed)' },
  PROCLAMATION:   { label: 'Proclamation',         color: 'var(--status-pending)' },
  PRES_ACTION:    { label: 'Presidential Action',  color: 'var(--status-default)' },
  PENDING:        { label: 'Pending',              color: 'var(--status-default)' },
  ARGUED:         { label: 'Argued',               color: 'var(--status-chamber)' },
  DECIDED:        { label: 'Decided',              color: 'var(--status-decided)' },
  DEVELOPING:     { label: 'Developing',           color: 'var(--status-pending)' },
  CONCLUDED:      { label: 'Concluded',            color: 'var(--status-default)' },
}

export function getStatusStyle(status: string | null) {
  return STATUS_STYLES[status ?? ''] ?? { label: status ?? '—', color: 'var(--status-default)' }
}

// ── Type badge ────────────────────────────────────────────────────────

const TYPE_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  legislative: {
    label: 'Legislative',
    bg: 'var(--badge-legislative-bg)',
    text: 'var(--badge-legislative-text)',
  },
  executive: {
    label: 'Executive',
    bg: 'var(--badge-executive-bg)',
    text: 'var(--badge-executive-text)',
  },
  judicial: {
    label: 'Judicial',
    bg: 'var(--badge-judicial-bg)',
    text: 'var(--badge-judicial-text)',
  },
  live: {
    label: 'Live',
    bg: 'var(--badge-live-bg, #fef3c7)',
    text: 'var(--badge-live-text, #92400e)',
  },
}

// ── Source line (derived without raw) ────────────────────────────────

function sourceLine(card: CardRow): string {
  const sphere = card.sphere === 'state' && card.region ? card.region : 'Federal'

  if (card.card_type === 'legislative') {
    if (card.source === 'congress') {
      // external_id = "119-hr-1234" → "HR 1234"
      const parts = card.external_id.split('-')
      if (parts.length >= 3) {
        const type = parts[1].toUpperCase()
        const num = parts.slice(2).join('-')
        return `${sphere} · ${type} ${num}`
      }
    }
    // legiscan: external_id is the bill_id number
    return `${sphere} · Bill`
  }

  if (card.card_type === 'executive') {
    return `Federal · ${getStatusStyle(card.status).label}`
  }

  if (card.card_type === 'judicial') {
    return `Federal · Docket`
  }

  if (card.card_type === 'live') {
    const n = card.news_audit?.outlets?.length
    return n ? `News · ${n} outlets` : 'News'
  }

  return sphere
}

// ── Date formatting ───────────────────────────────────────────────────

function formatDate(ts: string | null): string {
  if (!ts) return '—'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(ts))
}

// ── Card component ────────────────────────────────────────────────────

export default function Card({ card }: { card: CardRow }) {
  const typeBadge = TYPE_BADGE[card.card_type] ?? {
    label: card.card_type,
    bg: 'var(--color-border-subtle)',
    text: 'var(--color-text-secondary)',
  }
  const statusStyle = getStatusStyle(card.status)

  return (
    <Link
      href={`/cards/${card.id}`}
      style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
    >
      <article
        className="card-article"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: '8px',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        {/* Top row: type badge + status badge + region */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span
            style={{
              background: typeBadge.bg,
              color: typeBadge.text,
              fontSize: '0.7rem',
              fontWeight: 600,
              padding: '2px 7px',
              borderRadius: '999px',
              letterSpacing: '0.03em',
              textTransform: 'uppercase',
            }}
          >
            {typeBadge.label}
          </span>
          <span
            style={{
              color: statusStyle.color,
              fontSize: '0.75rem',
              fontWeight: 500,
            }}
          >
            {statusStyle.label}
          </span>
          <span
            style={{
              marginLeft: 'auto',
              fontSize: '0.72rem',
              color: 'var(--color-text-secondary)',
            }}
          >
            {sourceLine(card)}
          </span>
        </div>

        {/* Title */}
        <h2
          style={{
            margin: 0,
            fontSize: '0.95rem',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            lineHeight: 1.4,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {card.title}
        </h2>

        {/* Summary (if present) */}
        {card.summary && (
          <p
            style={{
              margin: 0,
              fontSize: '0.82rem',
              color: 'var(--color-text-secondary)',
              lineHeight: 1.5,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {card.summary}
          </p>
        )}

        {/* Bottom: date or live news meta */}
        {card.card_type === 'live' && card.news_audit ? (
          <LiveNewsMeta audit={card.news_audit} status={card.status} />
        ) : (
          <div
            style={{
              fontSize: '0.72rem',
              color: 'var(--color-text-secondary)',
            }}
          >
            {formatDate(card.last_action_at)}
          </div>
        )}
      </article>
    </Link>
  )
}
