'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import type { SortMode } from '@/app/lib/cards/types'

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'recent', label: 'Recent' },
  { value: 'trending', label: 'Trending' },
  { value: 'passed', label: 'Passed' },
]

const BRANCH_OPTIONS = [
  { value: 'legislative', label: 'Legislative' },
  { value: 'executive', label: 'Executive' },
  { value: 'judicial', label: 'Judicial' },
]

const SPHERE_OPTIONS = [
  { value: 'federal', label: 'Federal' },
  { value: 'state', label: 'State' },
]

export default function FeedControls() {
  const router = useRouter()
  const params = useSearchParams()

  // Default landing is Trending (all branches / both spheres blended).
  const currentSort = (params.get('sort') ?? 'trending') as SortMode
  const currentBranches = params.get('branch')?.split(',').filter(Boolean) ?? []
  const currentSpheres = params.get('sphere')?.split(',').filter(Boolean) ?? []

  function buildUrl(updates: {
    sort?: SortMode
    branches?: string[]
    spheres?: string[]
  }) {
    const sp = new URLSearchParams()
    const sort = updates.sort ?? currentSort
    const branches = updates.branches ?? currentBranches
    const spheres = updates.spheres ?? currentSpheres

    if (sort !== 'trending') sp.set('sort', sort)
    if (branches.length > 0) sp.set('branch', branches.join(','))
    if (spheres.length > 0) sp.set('sphere', spheres.join(','))
    // always reset to page 1 on filter change

    const qs = sp.toString()
    return qs ? `/?${qs}` : '/'
  }

  function toggleBranch(value: string) {
    const next = currentBranches.includes(value)
      ? currentBranches.filter((b) => b !== value)
      : [...currentBranches, value]
    router.push(buildUrl({ branches: next }))
  }

  function toggleSphere(value: string) {
    const next = currentSpheres.includes(value)
      ? currentSpheres.filter((s) => s !== value)
      : [...currentSpheres, value]
    router.push(buildUrl({ spheres: next }))
  }

  const tabStyle = (active: boolean) => ({
    padding: '5px 14px',
    borderRadius: '999px',
    fontSize: '0.82rem',
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    border: 'none',
    background: active ? 'var(--color-accent)' : 'transparent',
    color: active ? '#fff' : 'var(--color-text-secondary)',
    transition: 'background 0.15s, color 0.15s',
  } as React.CSSProperties)

  const toggleStyle = (active: boolean) => ({
    padding: '3px 10px',
    borderRadius: '999px',
    fontSize: '0.78rem',
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
    background: active ? 'var(--color-accent)' : 'var(--color-surface)',
    color: active ? '#fff' : 'var(--color-text-secondary)',
    transition: 'all 0.15s',
  } as React.CSSProperties)

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border-subtle)',
        padding: '10px 16px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '12px',
        alignItems: 'center',
      }}
    >
      {/* Sort tabs */}
      <div style={{ display: 'flex', gap: '4px' }}>
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            style={tabStyle(currentSort === opt.value)}
            onClick={() => router.push(buildUrl({ sort: opt.value }))}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div
        style={{
          width: '1px',
          height: '20px',
          background: 'var(--color-border-subtle)',
        }}
      />

      {/* Branch filter */}
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
        <span
          style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', marginRight: '2px' }}
        >
          Branch
        </span>
        {BRANCH_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            style={toggleStyle(currentBranches.includes(opt.value))}
            onClick={() => toggleBranch(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div
        style={{
          width: '1px',
          height: '20px',
          background: 'var(--color-border-subtle)',
        }}
      />

      {/* Sphere filter */}
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
        <span
          style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', marginRight: '2px' }}
        >
          Level
        </span>
        {SPHERE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            style={toggleStyle(currentSpheres.includes(opt.value))}
            onClick={() => toggleSphere(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
