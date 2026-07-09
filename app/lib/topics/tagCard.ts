import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import { createAdminClient } from '@/app/lib/supabase/admin'
import { POLICY_TOPICS, POLICY_TOPIC_SET, type PolicyTopic } from '@/app/lib/topics'
import { heuristicTopics } from '@/app/lib/news/topics'

const MODEL = 'gemini-2.5-flash'
const BUDGET_FEATURE = 'card_topics'

/** Shared free-tier headroom after Insight (150) + news promotions (~30). */
export const DAILY_CARD_TOPIC_CAP = 60
/** Soft per-cron-run ceiling so one invocation cannot drain the day. */
export const MAX_TOPIC_TAGS_PER_RUN = 20
/** How many untagged candidates to score before picking the top N. */
export const TOPIC_CANDIDATE_WINDOW = 500

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

async function tryClaimTopicBudget(): Promise<boolean> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('try_increment_gemini_budget', {
    p_day: todayUtc(),
    p_feature: BUDGET_FEATURE,
    p_cap: DAILY_CARD_TOPIC_CAP,
  })

  if (error) {
    if (
      error.code === 'PGRST202' ||
      error.message.includes('does not exist') ||
      error.message.includes('Could not find the function')
    ) {
      console.warn('[topics] gemini_budget migration not applied — budget cap skipped')
      return true
    }
    console.error('[topics] budget RPC error:', error.message)
    return false
  }
  return data === true
}

/**
 * Classify a government-action card into 1–3 POLICY_TOPICS.
 * Claims one unit of the card_topics daily budget before calling Gemini.
 * Falls back to keyword heuristic (budget already claimed) when Gemini fails.
 * Heuristic-only when GEMINI_API_KEY is missing does not consume budget.
 */
export async function tagGovernmentCardTopics(
  title: string,
  summary: string | null
): Promise<{ topics: PolicyTopic[]; usedGemini: boolean; budgetDenied: boolean }> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.warn('[topics] GEMINI_API_KEY missing — heuristic only')
    return {
      topics: heuristicTopics(title, summary).slice(0, 3),
      usedGemini: false,
      budgetDenied: false,
    }
  }

  const budgetOk = await tryClaimTopicBudget()
  if (!budgetOk) {
    return { topics: [], usedGemini: false, budgetDenied: true }
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
          topics: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.STRING,
              format: 'enum',
              enum: [...POLICY_TOPICS],
            },
          },
        },
        required: ['topics'],
      },
    },
  })

  const prompt = `Classify this U.S. government action into 1–3 topics from the fixed taxonomy only.
TITLE: ${title}
SUMMARY: ${(summary ?? '').slice(0, 500)}`

  try {
    const result = await model.generateContent(prompt)
    const text = result.response.text().trim()
    const parsed = JSON.parse(text) as { topics?: string[] }
    const topics = (parsed.topics ?? [])
      .filter((t): t is PolicyTopic => POLICY_TOPIC_SET.has(t))
      .slice(0, 3)
    if (topics.length > 0) {
      return { topics, usedGemini: true, budgetDenied: false }
    }
    return {
      topics: heuristicTopics(title, summary).slice(0, 3),
      usedGemini: true,
      budgetDenied: false,
    }
  } catch (err) {
    console.warn(
      '[topics] Gemini card tagging failed; using heuristic:',
      err instanceof Error ? err.message : err
    )
    return {
      topics: heuristicTopics(title, summary).slice(0, 3),
      usedGemini: false,
      budgetDenied: false,
    }
  }
}
