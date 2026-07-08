'use client'

import { useState } from 'react'
import type { NewsAuditSummary } from '@/app/lib/cards/types'
import Link from 'next/link'

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function LiveNewsMeta({ audit, status }: { audit: NewsAuditSummary; status: string | null }) {
  const [open, setOpen] = useState(false)
  const outletCount = audit.outlets?.length ?? 0
  const lastOutlet = audit.outlets?.[outletCount - 1]
  const cleared = audit.cleared_at ? relativeTime(audit.cleared_at) : '—'
  const lastNew = lastOutlet?.first_seen_at ? relativeTime(lastOutlet.first_seen_at) : '—'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div
        style={{
          fontSize: '0.75rem',
          color: 'var(--color-text-secondary)',
          lineHeight: 1.4,
        }}
      >
        Cleared threshold {cleared} · {outletCount} outlets · last new outlet {lastNew}
      </div>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setOpen((v) => !v)
          }}
          style={{
            fontSize: '0.72rem',
            color: 'var(--color-accent)',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            textDecoration: 'underline',
            textUnderlineOffset: '2px',
          }}
        >
          {open ? 'Hide audit trail' : 'Show audit trail'}
        </button>
        <Link
          href="/methodology"
          onClick={(e) => e.stopPropagation()}
          style={{
            fontSize: '0.72rem',
            color: 'var(--color-text-secondary)',
            textDecoration: 'underline',
            textUnderlineOffset: '2px',
          }}
        >
          Methodology
        </Link>
        {status === 'CONCLUDED' && (
          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)' }}>
            Tracking closed
          </span>
        )}
      </div>
      {open && (
        <div
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          style={{
            marginTop: '4px',
            padding: '10px',
            background: 'var(--color-bg)',
            borderRadius: '6px',
            border: '1px solid var(--color-border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)' }}>
            Rule {audit.rule_version} · clustering {audit.clustering_version} · outlets{' '}
            {audit.outlet_list_version} · N={audit.rule.n} · {audit.rule.window_hours}h window
          </div>
          {audit.outlets.map((o) => (
            <div
              key={`${o.outlet_id}-${o.first_seen_at}`}
              style={{
                fontSize: '0.78rem',
                color: 'var(--color-text-primary)',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
              }}
            >
              <div>
                <strong>{o.name}</strong>{' '}
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  ({o.bucket}
                  {o.via_wire ? ` · via ${o.via_wire}` : ''})
                </span>
              </div>
              <div style={{ color: 'var(--color-text-secondary)' }}>
                {new Date(o.first_seen_at).toLocaleString()} ·{' '}
                <a
                  href={o.item_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--color-accent)' }}
                >
                  {o.item_title.slice(0, 80)}
                  {o.item_title.length > 80 ? '…' : ''}
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
