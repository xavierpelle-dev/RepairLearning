/**
 * Turning a model's reply into cards. The prompt asks for strict JSON, and
 * everything that comes back is checked against `isValidCard` before it is
 * kept, so a malformed or over-long card is dropped rather than shown. No
 * Claude Code access here either: `register.tsx` makes the call and passes
 * the reply in, so this is tested without a model.
 */
import type { Card, Lang, Topic } from '../types'
import { hashOf, isValidCard, labelOf, MAX_EXPLAIN, MAX_TEXT, MIN_EXPLAIN } from '../hooks/planner'

/** Cards asked for in one request. Batched, so one round trip fills a while. */
export const BATCH = 8

/** Tokens one batch needs, with room to spare; the default of 1024 is short. */
export const BATCH_TOKENS = 2500

export const TIMEOUT_MS = 20_000

/** The model asked for cards: the cheapest one, called often and in the background. */
export const MODEL = 'haiku'

/** The job, written once and reused for every topic. */
export const SYSTEM = [
  'You write very short learning cards for an experienced programmer who is',
  'waiting a few seconds for an AI coding agent to finish. Each card teaches',
  'one concrete, correct, non-obvious thing about the topic.',
  '',
  'Reply with a JSON array and nothing else. No prose, no code fence.',
  'Each element is an object with these fields:',
  '  "kind":    "fact" or "yesno"',
  `  "text":    the fact, or the question. Under ${MAX_TEXT} characters.`,
  '             A "yesno" text must end with "?".',
  '  "answer":  true or false. Only on a "yesno", never on a "fact".',
  `  "explain": why, in one or two sentences, ${MIN_EXPLAIN}-${MAX_EXPLAIN} characters.`,
  '             Only on a "yesno", never on a "fact".',
  '',
  'Rules:',
  '- Half the cards "fact", half "yesno".',
  '- Mix the answers: some true, some false. Never make them all one way.',
  '- Wrap code, commands and identifiers in backticks.',
  '- Prefer things people get wrong over things people look up.',
  '- No opinions, no "it depends", nothing that changes between versions',
  '  unless the card names the version.',
].join('\n')

/** The request for one topic, naming cards already held so they are not repeated. */
export function buildPrompt(topic: Topic, avoid: readonly string[], lang: Lang = 'en'): string {
  const lines = [`Topic: ${labelOf(topic)}.`, `Write ${BATCH} cards.`]
  if (lang === 'fr') {
    lines.push('Write "text" and "explain" in French. Keep code, commands and identifiers as they are.')
  }
  if (avoid.length > 0) {
    lines.push('', 'Do not repeat any of these, which the reader already has:')
    for (const text of avoid.slice(0, 40)) lines.push(`- ${text}`)
  }
  return lines.join('\n')
}

/** How many openings to try before giving up on a reply. */
const TRIES = 8

/**
 * Pulls the JSON array out of a reply. The model is told to send nothing but
 * the array, but a reply is worth a few attempts before a paid request is
 * thrown away: every fenced block is tried, then the whole reply, and within
 * each, every `[` in turn, since prose can hold brackets of its own.
 */
function parseArray(reply: string): unknown[] {
  const candidates: string[] = []
  for (const match of reply.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) {
    const body = match[1]
    if (body !== undefined) candidates.push(body)
  }
  candidates.push(reply)

  let tries = 0
  for (const candidate of candidates) {
    const end = candidate.lastIndexOf(']')
    if (end === -1) continue
    for (let start = candidate.indexOf('['); start !== -1 && start < end; start = candidate.indexOf('[', start + 1)) {
      if (tries >= TRIES) return []
      tries += 1
      try {
        const parsed: unknown = JSON.parse(candidate.slice(start, end + 1))
        if (Array.isArray(parsed)) return parsed
      } catch {
        // This opening was not the start of the array; try the next one.
      }
    }
  }
  return []
}

/**
 * The cards in a reply: parsed, given ids and the topic they were asked for,
 * and filtered down to the ones fit to show. A reply that is not JSON, or
 * whose cards are all malformed, yields an empty list and nothing is kept.
 */
export function parseCards(topic: Topic, reply: string, lang: Lang = 'en'): Card[] {
  const out: Card[] = []
  const seen = new Set<string>()
  for (const raw of parseArray(reply)) {
    if (typeof raw !== 'object' || raw === null) continue
    const fields = raw as Record<string, unknown>
    const text = typeof fields['text'] === 'string' ? fields['text'].trim() : ''
    if (text.length === 0) continue
    const kind = fields['kind']
    // The model is told to leave these off a fact; drop them if it did not.
    const isAsking = kind === 'yesno'
    const card: Card = {
      id: `ai-${topic}-${hashOf(text)}`,
      topic,
      kind: isAsking ? 'yesno' : 'fact',
      text,
      source: 'ai',
      lang,
      ...(isAsking ? { answer: fields['answer'] === true } : {}),
      ...(isAsking && typeof fields['explain'] === 'string' ? { explain: fields['explain'].trim() } : {}),
    }
    if (kind !== 'fact' && kind !== 'yesno') continue
    if (!isValidCard(card)) continue
    if (seen.has(card.id)) continue
    seen.add(card.id)
    out.push(card)
  }
  return out
}
