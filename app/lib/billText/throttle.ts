const hostLocks = new Map<string, Promise<void>>()
const hostLastRequest = new Map<string, number>()

const MIN_HOST_INTERVAL_MS = 1_000
const MAX_HOST_INTERVAL_MS = 2_000

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return 'unknown'
  }
}

function randomDelay(): number {
  return MIN_HOST_INTERVAL_MS + Math.random() * (MAX_HOST_INTERVAL_MS - MIN_HOST_INTERVAL_MS)
}

/**
 * Per-host throttle: 1 concurrent request, 1–2s spacing (SPEC §5).
 */
export async function withHostThrottle<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const host = hostFromUrl(url)

  const prior = hostLocks.get(host) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })

  const chain = prior.then(async () => {
    const last = hostLastRequest.get(host) ?? 0
    const wait = Math.max(0, last + randomDelay() - Date.now())
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    hostLastRequest.set(host, Date.now())
  })

  hostLocks.set(host, chain.then(() => gate))

  await chain
  try {
    return await fn()
  } finally {
    release()
    if (hostLocks.get(host) === chain.then(() => gate)) {
      hostLocks.delete(host)
    }
  }
}
