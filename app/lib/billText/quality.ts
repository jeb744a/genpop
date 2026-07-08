import { readFileSync } from 'fs'
import wordListPath from 'word-list'

/**
 * Garbled-text quality gate thresholds (SPEC addition).
 * Tune against real Alabama bill-text output before launch.
 */
export const QUALITY_THRESHOLDS = {
  /** Below this char count → image_only (SPEC §2). */
  MIN_CHAR_COUNT: 200,
  /** Minimum share of ≥3-char tokens that are plausible English words. */
  MIN_DICTIONARY_RATIO: 0.55,
  /** Average token length must fall within this range. */
  MIN_AVG_TOKEN_LENGTH: 3,
  MAX_AVG_TOKEN_LENGTH: 12,
} as const

export const LEGISLATIVE_MARKERS = [
  'section',
  'act',
  'shall',
  'amended',
  'enacted',
] as const

const ENGLISH_WORDS = new Set(
  readFileSync(wordListPath, 'utf8')
    .split('\n')
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length >= 3)
)

export interface QualityCheckResult {
  passed: boolean
  char_count: number
  dictionary_ratio: number | null
  avg_token_length: number | null
  has_legislative_marker: boolean
  failure_reason?: string
}

function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map((t) => t.replace(/[^a-zA-Z'-]/g, '').toLowerCase())
    .filter((t) => t.length >= 3)
}

function isPlausibleWord(token: string): boolean {
  if (ENGLISH_WORDS.has(token)) return true
  // Allow common legislative compounds / proper nouns with standard morphology
  if (/^[a-z]{3,20}$/.test(token) && /[aeiouy]/.test(token)) {
    const suffixes = [
      'tion',
      'ment',
      'able',
      'ness',
      'ing',
      'ed',
      'es',
      'ly',
      'er',
      'or',
      'al',
      'ic',
      'ive',
      'ary',
      'ity',
    ]
    if (suffixes.some((s) => token.endsWith(s))) return true
  }
  return false
}

function hasLegislativeMarker(text: string): boolean {
  const lower = text.toLowerCase()
  return LEGISLATIVE_MARKERS.some((m) => lower.includes(m))
}

/**
 * Run quality checks after PDF extraction (SPEC addition).
 * Returns failure_reason when text should be classified low_quality.
 */
export function checkTextQuality(text: string): QualityCheckResult {
  const char_count = text.trim().length
  const tokens = tokenize(text)

  if (char_count < QUALITY_THRESHOLDS.MIN_CHAR_COUNT) {
    return {
      passed: false,
      char_count,
      dictionary_ratio: null,
      avg_token_length: null,
      has_legislative_marker: false,
      failure_reason: 'char_count_below_minimum',
    }
  }

  const has_legislative_marker = hasLegislativeMarker(text)
  if (!has_legislative_marker) {
    return {
      passed: false,
      char_count,
      dictionary_ratio: tokens.length ? tokens.filter(isPlausibleWord).length / tokens.length : 0,
      avg_token_length: tokens.length
        ? tokens.reduce((s, t) => s + t.length, 0) / tokens.length
        : null,
      has_legislative_marker: false,
      failure_reason: 'missing_legislative_marker',
    }
  }

  const plausibleCount = tokens.filter(isPlausibleWord).length
  const dictionary_ratio = tokens.length > 0 ? plausibleCount / tokens.length : 0
  const avg_token_length =
    tokens.length > 0 ? tokens.reduce((s, t) => s + t.length, 0) / tokens.length : null

  if (dictionary_ratio < QUALITY_THRESHOLDS.MIN_DICTIONARY_RATIO) {
    return {
      passed: false,
      char_count,
      dictionary_ratio,
      avg_token_length,
      has_legislative_marker,
      failure_reason: 'low_dictionary_ratio',
    }
  }

  if (
    avg_token_length === null ||
    avg_token_length < QUALITY_THRESHOLDS.MIN_AVG_TOKEN_LENGTH ||
    avg_token_length > QUALITY_THRESHOLDS.MAX_AVG_TOKEN_LENGTH
  ) {
    return {
      passed: false,
      char_count,
      dictionary_ratio,
      avg_token_length,
      has_legislative_marker,
      failure_reason: 'avg_token_length_out_of_range',
    }
  }

  return {
    passed: true,
    char_count,
    dictionary_ratio,
    avg_token_length,
    has_legislative_marker,
  }
}

/** Classify extracted text into ok | image_only | low_quality. */
export function classifyExtractedText(
  text: string
): { status: 'ok' | 'image_only' | 'low_quality'; quality: QualityCheckResult } {
  const quality = checkTextQuality(text)
  if (quality.char_count < QUALITY_THRESHOLDS.MIN_CHAR_COUNT) {
    return { status: 'image_only', quality }
  }
  if (!quality.passed) {
    return { status: 'low_quality', quality }
  }
  return { status: 'ok', quality }
}
