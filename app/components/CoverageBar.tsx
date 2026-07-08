export default function CoverageBar() {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border-subtle)',
        padding: '6px 16px',
        fontSize: '0.78rem',
        color: 'var(--color-text-secondary)',
        lineHeight: 1.4,
      }}
    >
      <strong style={{ color: 'var(--color-text-primary)' }}>Coverage:</strong>{' '}
      Federal: complete (all 3 branches) · State legislation: all 50 states ·{' '}
      State executive/judicial: rolling out
    </div>
  )
}
