export interface RssItem {
  title: string
  link: string
  guid?: string
  description?: string
  pubDate?: string
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim()
}

function extractTag(block: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const m = block.match(re)
  if (!m) return undefined
  return decodeXmlEntities(m[1])
}

/** Lightweight RSS/Atom item parser for feed verification. */
export function parseFeedItems(xml: string): RssItem[] {
  const items: RssItem[] = []

  const rssItemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi
  let m: RegExpExecArray | null
  while ((m = rssItemRegex.exec(xml)) !== null) {
    const block = m[1]
    const title = extractTag(block, 'title')
    const link = extractTag(block, 'link') ?? extractTag(block, 'guid')
    if (!title || !link) continue
    items.push({
      title,
      link,
      guid: extractTag(block, 'guid'),
      description: extractTag(block, 'description'),
      pubDate: extractTag(block, 'pubDate'),
    })
  }

  if (items.length > 0) return items

  // Atom fallback
  const entryRegex = /<entry[\s>]([\s\S]*?)<\/entry>/gi
  while ((m = entryRegex.exec(xml)) !== null) {
    const block = m[1]
    const title = extractTag(block, 'title')
    const linkMatch = block.match(/<link[^>]+href=["']([^"']+)["']/i)
    const link = linkMatch?.[1] ?? extractTag(block, 'id')
    if (!title || !link) continue
    items.push({
      title,
      link,
      guid: extractTag(block, 'id'),
      description: extractTag(block, 'summary') ?? extractTag(block, 'content'),
      pubDate: extractTag(block, 'updated') ?? extractTag(block, 'published'),
    })
  }

  return items
}
