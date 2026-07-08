import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import { POLICY_TOPICS, POLICY_TOPIC_SET, type PolicyTopic } from '@/app/lib/topics'

const MODEL = 'gemini-2.5-flash'

const KEYWORD_TOPICS: Array<{ topic: PolicyTopic; patterns: RegExp[] }> = [
  {
    topic: 'immigration_border',
    patterns: [/\bimmigration\b/i, /\bborder\b/i, /\basylum\b/i, /\bice\b/i],
  },
  {
    topic: 'courts_judiciary',
    patterns: [/\bsupreme court\b/i, /\bscotus\b/i, /\bfederal court\b/i, /\bjudge\b/i],
  },
  {
    topic: 'congress_legislation',
    patterns: [/\bsenate\b/i, /\bhouse\b/i, /\bcongress\b/i, /\bhr\s?\d+\b/i, /\bbill\b/i],
  },
  {
    topic: 'executive_action',
    patterns: [/\bwhite house\b/i, /\bexecutive order\b/i, /\bpresident\b/i],
  },
  {
    topic: 'elections_voting',
    patterns: [/\belection\b/i, /\bprimary\b/i, /\bvoting\b/i, /\bballot\b/i],
  },
  {
    topic: 'foreign_policy_defense',
    patterns: [/\bnato\b/i, /\bmilitary\b/i, /\bwar\b/i, /\bsanction\b/i, /\biran\b/i],
  },
  { topic: 'economy_trade', patterns: [/\beconomy\b/i, /\btariff\b/i, /\binflation\b/i] },
  { topic: 'healthcare', patterns: [/\bhealthcare\b/i, /\bmedicaid\b/i, /\bmedicare\b/i] },
]

const NON_CIVIC = [/\bsports?\b/i, /\bcelebrity\b/i, /\bhollywood\b/i, /\bhollywood\b/i, /\bmusic\b/i]

/** Deterministic fallback when Gemini is unavailable or returns invalid JSON. */
export function heuristicTopics(title: string, summary: string | null): PolicyTopic[] {
  const text = `${title}\n${summary ?? ''}`
  if (NON_CIVIC.some((re) => re.test(text)) && !KEYWORD_TOPICS.some((k) => k.patterns.some((p) => p.test(text)))) {
    return []
  }
  const hits: PolicyTopic[] = []
  for (const k of KEYWORD_TOPICS) {
    if (k.patterns.some((p) => p.test(text))) hits.push(k.topic)
  }
  return hits.slice(0, 3)
}

/**
 * Topic-tag a promoted news cluster. One call per promotion (SPEC §4.1 / §7).
 * Falls back to keyword heuristic if Gemini fails (still one attempt counted).
 */
export async function tagNewsTopics(title: string, summary: string | null): Promise<PolicyTopic[]> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.warn('[news] GEMINI_API_KEY missing — using heuristic topic gate')
    return heuristicTopics(title, summary)
  }

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: MODEL,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 128,
      responseMimeType: 'application/json',
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          civic: { type: SchemaType.BOOLEAN },
          topics: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.STRING,
              format: 'enum',
              enum: [...POLICY_TOPICS],
            },
          },
        },
        required: ['civic', 'topics'],
      },
    },
  })

  const prompt = `Classify this U.S. news item. civic=false only for pure sports/celebrity/entertainment.
TITLE: ${title}
SUMMARY: ${(summary ?? '').slice(0, 400)}`

  try {
    const result = await model.generateContent(prompt)
    const text = result.response.text().trim()
    const parsed = JSON.parse(text) as { topics?: string[]; civic?: boolean }
    if (parsed.civic === false) return []
    const topics = (parsed.topics ?? []).filter((t): t is PolicyTopic => POLICY_TOPIC_SET.has(t))
    if (topics.length > 0) return topics.slice(0, 3)
    return heuristicTopics(title, summary)
  } catch (err) {
    console.warn(
      '[news] topic tagging Gemini failed; using heuristic:',
      err instanceof Error ? err.message : err
    )
    return heuristicTopics(title, summary)
  }
}

export function isCivicTopics(topics: string[]): boolean {
  return topics.some((t) => POLICY_TOPIC_SET.has(t))
}
