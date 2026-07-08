'use client'

import { useEffect, useState } from 'react'
import type {
  InsightApiResponse,
  InsightContent,
  InsightSlots,
  SlotValue,
  WhatChangeEntry,
} from '@/app/lib/aiInsight/types'

const NOT_SPECIFIED = 'Not specified in the source'

const SLOT_LABELS: Record<string, string> = {
  what_it_does: 'What it does',
  what_changes: 'What changes',
  who_is_affected: 'Who is affected',
  effective_date: 'Effective date',
  sunset: 'Sunset',
  fiscal_note: 'Fiscal note',
  current_status: 'Current status',
  source_refs: 'Source references',
  what_it_directs: 'What it directs',
  what_changes_operationally: 'Operational changes',
  who_is_bound: 'Who is bound',
  legal_authority: 'Legal authority',
  what_was_decided: 'What was decided',
  holding: 'Holding',
  what_changes_going_forward: 'Going forward',
  still_unresolved: 'Still unresolved',
}

function formatSlotValue(value: unknown): string {
  if (value === NOT_SPECIFIED) return NOT_SPECIFIED
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const changes = value as WhatChangeEntry[]
    if (changes.every((c) => c && typeof c === 'object' && ('from' in c || 'to' in c))) {
      return changes
        .map((c) => `${c.from || '—'} → ${c.to || '—'}`)
        .join('; ')
    }
    return JSON.stringify(value)
  }
  return String(value)
}

function isMetadataOnlySlot(
  slotKey: string,
  slot: SlotValue,
  sourceText: InsightContent['meta']['source_text']
): boolean {
  if (sourceText !== 'unavailable') return false
  if (slotKey === 'current_status') return false
  if (slot.value === NOT_SPECIFIED) return false
  return true
}

function SlotRow({
  slotKey,
  slot,
  sourceUrl,
  sourceText,
}: {
  slotKey: string
  slot: SlotValue
  sourceUrl: string | null | undefined
  sourceText: InsightContent['meta']['source_text']
}) {
  const label = SLOT_LABELS[slotKey] ?? slotKey
  const metadataOnly = isMetadataOnlySlot(slotKey, slot, sourceText)
  const snippets = slot.source_snippets?.filter((s) => s.quote?.trim()) ?? []
  const primarySnippet = snippets[0]

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '16px',
        padding: '12px 0',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      <div>
        <div
          style={{
            fontSize: '0.72rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--color-text-secondary)',
            marginBottom: '6px',
          }}
        >
          {label}
        </div>
        <p
          style={{
            margin: 0,
            fontSize: '0.9rem',
            lineHeight: 1.55,
            color: 'var(--color-text-primary)',
          }}
        >
          {formatSlotValue(slot.value)}
        </p>
        {metadataOnly && (
          <p
            style={{
              margin: '8px 0 0',
              fontSize: '0.78rem',
              color: 'var(--color-text-secondary)',
              fontStyle: 'italic',
            }}
          >
            Derived from bill metadata; full text not yet available.
          </p>
        )}
      </div>

      <div>
        <div
          style={{
            fontSize: '0.72rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--color-text-secondary)',
            marginBottom: '6px',
          }}
        >
          Source
        </div>
        {primarySnippet ? (
          <blockquote
            style={{
              margin: 0,
              padding: '8px 12px',
              borderLeft: '3px solid var(--color-accent)',
              background: 'var(--color-bg)',
              borderRadius: '0 4px 4px 0',
              fontSize: '0.85rem',
              lineHeight: 1.5,
              color: 'var(--color-text-primary)',
            }}
          >
            &ldquo;{primarySnippet.quote}&rdquo;
            {primarySnippet.location && (
              <footer
                style={{
                  marginTop: '6px',
                  fontSize: '0.75rem',
                  color: 'var(--color-text-secondary)',
                }}
              >
                {primarySnippet.location}
              </footer>
            )}
          </blockquote>
        ) : (
          <p
            style={{
              margin: 0,
              fontSize: '0.85rem',
              color: 'var(--color-text-secondary)',
              fontStyle: 'italic',
            }}
          >
            {slot.value === NOT_SPECIFIED
              ? NOT_SPECIFIED
              : metadataOnly
                ? 'Derived from bill metadata; full text not yet available.'
                : 'No verbatim snippet available.'}
          </p>
        )}
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              marginTop: '8px',
              fontSize: '0.78rem',
              color: 'var(--color-accent)',
              textDecoration: 'none',
            }}
          >
            View source document →
          </a>
        )}
      </div>
    </div>
  )
}

function InsightSlotsView({
  content,
  sourceUrl,
}: {
  content: InsightContent
  sourceUrl: string | null | undefined
}) {
  const slotOrder = Object.keys(content.slots)
  const isPendingDocket = content.meta.source_text === 'pending'

  return (
    <div>
      {isPendingDocket && (
        <p
          style={{
            margin: '0 0 12px',
            padding: '10px 12px',
            background: 'var(--color-bg)',
            borderRadius: '6px',
            fontSize: '0.85rem',
            color: 'var(--color-text-secondary)',
          }}
        >
          This case has been filed, not yet decided.
        </p>
      )}
      {slotOrder.map((key) => {
        const slot = (content.slots as InsightSlots)[key as keyof InsightSlots]
        if (!slot) return null
        return (
          <SlotRow
            key={key}
            slotKey={key}
            slot={slot as SlotValue}
            sourceUrl={sourceUrl}
            sourceText={content.meta.source_text}
          />
        )
      })}
    </div>
  )
}

export function InsightPanel({ cardId }: { cardId: string }) {
  const [data, setData] = useState<InsightApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch(`/api/cards/${cardId}/insight`)
        if (!res.ok) {
          if (res.status === 404) {
            setError('Card not found.')
            return
          }
          throw new Error(`HTTP ${res.status}`)
        }
        const json = (await res.json()) as InsightApiResponse
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load insight')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [cardId])

  return (
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
          margin: '0 0 4px',
          fontSize: '0.8rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--color-text-secondary)',
        }}
      >
        AI Insight
      </h2>
      <p
        style={{
          margin: '0 0 16px',
          fontSize: '0.78rem',
          color: 'var(--color-text-secondary)',
        }}
      >
        Neutral, source-grounded explanation. Every claim is paired with the underlying text.
      </p>

      {loading && (
        <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--color-text-secondary)' }}>
          Loading insight…
        </p>
      )}

      {error && (
        <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--status-vetoed)' }}>{error}</p>
      )}

      {!loading && !error && data?.state === 'pending' && (
        <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--color-text-secondary)' }}>
          {data.message ?? 'Summary is being prepared — check back shortly.'}
        </p>
      )}

      {!loading && !error && data?.state === 'unavailable' && (
        <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--color-text-secondary)' }}>
          {data.message ?? 'Insight is not available for this card.'}
        </p>
      )}

      {!loading && !error && data?.state === 'ready' && data.content && (
        <InsightSlotsView content={data.content} sourceUrl={data.source_url} />
      )}

      <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--color-border-subtle)' }}>
        <button
          type="button"
          disabled
          title="Sign in and verify your identity to report issues with this summary."
          style={{
            fontSize: '0.78rem',
            color: 'var(--color-text-secondary)',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'not-allowed',
            textDecoration: 'underline',
            textUnderlineOffset: '2px',
          }}
        >
          Report an issue with this summary
        </button>
      </div>
    </section>
  )
}
