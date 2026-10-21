/**
 * RepairLearning's decisions, with no access to Claude Code: which topic a tool call
 * points at, which card comes next, how an answer moves a card between
 * spaced-repetition boxes, and whether a card is fit to show. Everything here
 * is a plain function of its inputs, so it is tested directly.
 */
import type { Card, Lang, Topic } from '../types'

/** A card's place in the Leitner system, kept per card id in the store. */
export type CardProgress = {
  /** 1 to 5; a wrong answer sends a card back to box 1. */
  box: number
  /** The day (YYYY-MM-DD) the card is next due for review. */
  due: string
  seen: number
  right: number
}

export type Progress = Readonly<Record<string, CardProgress>>

/**
 * How much each topic is worth when the next card's topic is drawn. A topic
 * with no entry is worth `BASE_WEIGHT`, so the map holds only the topics this
 * session has actually seen rather than every topic that exists.
 */
export type Weights = Readonly<Record<Topic, number>>

/** Days until a card in each box comes back: box 1 tomorrow, box 5 in 16 days. */
export const INTERVAL_DAYS = [1, 2, 4, 8, 16] as const

/** Every topic stays possible, so a session about one language still mixes. */
export const BASE_WEIGHT = 0.5

/** How much of a topic's weight carries into the next turn. */
export const DECAY = 0.8

/** The topics the shipped packs cover. */
export const PACK_TOPICS: readonly Topic[] = ['javascript', 'php', 'git']

export function freshWeights(): Weights {
  return {}
}

/** A topic's weight, or the base weight when the session has not seen it. */
export function weightOf(weights: Weights, topic: Topic): number {
  return weights[topic] ?? BASE_WEIGHT
}

/** Fades older signals at the start of a turn, never below the base weight. */
export function decay(weights: Weights): Weights {
  const out: Record<Topic, number> = {}
  for (const [topic, weight] of Object.entries(weights)) {
    out[topic] = Math.max(BASE_WEIGHT, weight * DECAY)
  }
  return out
}

/** Adds one to a topic's weight. */
export function bump(weights: Weights, topic: Topic): Weights {
  return { ...weights, [topic]: weightOf(weights, topic) + 1 }
}

/** The topic the session leans towards most, or `null` with no signal yet. */
export function leadingTopic(weights: Weights): Topic | null {
  let best: Topic | null = null
  let most = BASE_WEIGHT
  for (const [topic, weight] of Object.entries(weights)) {
    if (weight > most) {
      best = topic
      most = weight
    }
  }
  return best
}

const EXTENSIONS: ReadonlyArray<[RegExp, Topic]> = [
  // The shipped pack covers JavaScript and TypeScript together, so both map
  // to one topic rather than splitting the pack's cards away from .ts files.
  [/\.(m|c)?(j|t)sx?$/i, 'javascript'],
  [/(^|\/)(package\.json|tsconfig[^/]*\.json)$/i, 'javascript'],
  [/\.pyi?$/i, 'python'],
  [/(^|\/)(pyproject\.toml|requirements[^/]*\.txt|setup\.py)$/i, 'python'],
  [/(^|\/)\.git(ignore|attributes|modules)$/i, 'git'],
  [/\.rs$/i, 'rust'],
  [/(^|\/)Cargo\.toml$/i, 'rust'],
  [/\.go$/i, 'go'],
  [/(^|\/)go\.(mod|sum)$/i, 'go'],
  [/\.rb$/i, 'ruby'],
  [/(^|\/)(Gemfile|Rakefile)$/i, 'ruby'],
  [/\.java$/i, 'java'],
  [/(^|\/)(pom\.xml|build\.gradle(\.kts)?)$/i, 'java'],
  [/\.kts?$/i, 'kotlin'],
  [/\.swift$/i, 'swift'],
  [/\.php$/i, 'php'],
  [/\.cs$/i, 'csharp'],
  [/\.sql$/i, 'sql'],
  [/\.tf(vars)?$/i, 'terraform'],
  [/(^|\/)(Dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/i, 'docker'],
  [/\.(sh|bash|zsh)$/i, 'shell'],
  [/\.s?css$/i, 'css'],
]

const PROGRAMS: Readonly<Record<string, Topic>> = {
  git: 'git',
  gh: 'git',
  node: 'javascript',
  npm: 'javascript',
  npx: 'javascript',
  pnpm: 'javascript',
  yarn: 'javascript',
  bun: 'javascript',
  deno: 'javascript',
  tsc: 'javascript',
  python: 'python',
  python3: 'python',
  pip: 'python',
  pip3: 'python',
  pytest: 'python',
  uv: 'python',
  poetry: 'python',
  ruff: 'python',
  mypy: 'python',
  cargo: 'rust',
  rustc: 'rust',
  rustup: 'rust',
  go: 'go',
  gofmt: 'go',
  ruby: 'ruby',
  rails: 'ruby',
  bundle: 'ruby',
  gem: 'ruby',
  rake: 'ruby',
  java: 'java',
  javac: 'java',
  mvn: 'java',
  gradle: 'java',
  kotlinc: 'kotlin',
  swift: 'swift',
  php: 'php',
  composer: 'php',
  dotnet: 'csharp',
  psql: 'sql',
  mysql: 'sql',
  sqlite3: 'sql',
  docker: 'docker',
  'docker-compose': 'docker',
  podman: 'docker',
  kubectl: 'kubernetes',
  helm: 'kubernetes',
  k9s: 'kubernetes',
  minikube: 'kubernetes',
  terraform: 'terraform',
  tofu: 'terraform',
}

/**
 * The topic one tool call points at: a file's extension for the file tools,
 * the program a shell command starts with for Bash. `null` when neither says.
 */
export function topicOf(tool: string, input: Readonly<Record<string, unknown>>): Topic | null {
  const path = input['file_path'] ?? input['notebook_path'] ?? input['path']
  if (typeof path === 'string') {
    const normal = path.replace(/\\/g, '/')
    for (const [pattern, topic] of EXTENSIONS) {
      if (pattern.test(normal)) return topic
    }
  }
  const command = input['command']
  if ((tool === 'Bash' || tool === 'PowerShell') && typeof command === 'string') {
    for (const step of command.split(/&&|\|\||;|\|/)) {
      const words = step.trim().split(/\s+/)
      // Skip leading `FOO=bar` assignments.
      const program = words.find(word => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word))
      const topic = program ? PROGRAMS[program.replace(/^.*\//, '').toLowerCase()] : undefined
      if (topic) return topic
    }
  }
  return null
}

/**
 * Project files that say what a repository is written in, checked once at
 * session start so the very first card already fits the project.
 */
export const PROJECT_FILES: ReadonlyArray<[string, Topic]> = [
  ['package.json', 'javascript'],
  ['tsconfig.json', 'javascript'],
  ['pyproject.toml', 'python'],
  ['requirements.txt', 'python'],
  ['setup.py', 'python'],
  ['Cargo.toml', 'rust'],
  ['go.mod', 'go'],
  ['Gemfile', 'ruby'],
  ['pom.xml', 'java'],
  ['composer.json', 'php'],
  ['Dockerfile', 'docker'],
]

/** Raises the weight of each topic a project file pointed at, once per topic. */
export function seed(weights: Weights, found: readonly Topic[]): Weights {
  return [...new Set(found)].reduce(bump, weights)
}

const LABELS: Readonly<Record<string, string>> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  git: 'Git',
  rust: 'Rust',
  go: 'Go',
  ruby: 'Ruby',
  java: 'Java',
  kotlin: 'Kotlin',
  swift: 'Swift',
  php: 'PHP',
  csharp: 'C#',
  sql: 'SQL',
  docker: 'Docker',
  kubernetes: 'Kubernetes',
  terraform: 'Terraform',
  shell: 'Shell',
  css: 'CSS',
}

/** The name a topic is shown under in the band and in `/repairlearning`. */
export function labelOf(topic: Topic): string {
  return LABELS[topic] ?? topic.charAt(0).toUpperCase() + topic.slice(1)
}

/**
 * A tool call Claude asked the person to approve, or a question it put to
 * them. `tool` and `key` identify the call; both are empty for a question.
 */
export type Ask = { tool: string; key: string; at: number }

/** The input field that tells one call of a tool from another. */
export function keyOf(input: Readonly<Record<string, unknown>>): string {
  for (const field of ['command', 'file_path', 'notebook_path', 'url', 'pattern', 'query']) {
    const value = input[field]
    if (typeof value === 'string') return value
  }
  return ''
}

/**
 * Whether Claude has moved on from an ask: the call that asked has finished,
 * or a new tool call started after it, which Claude only does once answered.
 */
export function isAnswered(ask: Ask, call: { tool: string; key: string; startedAt: number }, isFinished: boolean): boolean {
  if (!isFinished) return call.startedAt > ask.at
  return ask.tool !== '' && call.tool === ask.tool && call.key === ask.key
}

/** The day of a timestamp, as YYYY-MM-DD in UTC. */
export function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDays(day: string, days: number): string {
  return dayOf(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000)
}

/**
 * Records one answer. `isRight` is `null` for a fact, which was only read:
 * it moves up a box like a right answer, so facts come back less and less.
 */
export function grade(progress: Progress, card: Card, isRight: boolean | null, today: string): Progress {
  const before = progress[card.id] ?? { box: 0, due: today, seen: 0, right: 0 }
  const box = isRight === false ? 1 : Math.min(INTERVAL_DAYS.length, before.box + 1)
  const wait = INTERVAL_DAYS[box - 1] ?? 1
  return {
    ...progress,
    [card.id]: {
      box,
      due: addDays(today, wait),
      seen: before.seen + 1,
      right: before.right + (isRight === true ? 1 : 0),
    },
  }
}

/**
 * The longest a card's question or fact may be, so the band stays short.
 * Sized for French, which runs about a fifth longer than English.
 */
export const MAX_TEXT = 150

/** The bounds an explanation has to fall inside. */
export const MIN_EXPLAIN = 11
export const MAX_EXPLAIN = 230

/**
 * Whether a card is fit to show. The shipped packs are checked against this in
 * the tests, and every generated card is filtered through it before it is
 * kept, so a model that writes something too long, one-sided or malformed has
 * that card dropped rather than shown.
 */
export function isValidCard(value: unknown): value is Card {
  if (typeof value !== 'object' || value === null) return false
  const card = value as Partial<Card>
  if (typeof card.id !== 'string' || card.id.length === 0) return false
  if (typeof card.topic !== 'string' || card.topic.length === 0) return false
  if (typeof card.text !== 'string') return false
  if (card.text.length === 0 || card.text.length >= MAX_TEXT) return false
  if (card.kind === 'fact') return card.answer === undefined
  if (card.kind !== 'yesno') return false
  if (typeof card.answer !== 'boolean') return false
  if (!card.text.endsWith('?')) return false
  const explain = card.explain
  return typeof explain === 'string' && explain.length >= MIN_EXPLAIN && explain.length <= MAX_EXPLAIN
}

/**
 * A card as it is shown in `lang`: a shipped card swaps in its French text,
 * and keeps its id, so progress carries over when the language changes.
 */
export function inLang(card: Card, lang: Lang): Card {
  if (lang !== 'fr' || !card.fr) return card
  return { ...card, text: card.fr.text, ...(card.fr.explain === undefined ? {} : { explain: card.fr.explain }) }
}

/** Whether a generated card belongs to `lang`; one stored before languages is English. */
export function isInLang(card: Card, lang: Lang): boolean {
  return (card.lang ?? 'en') === lang
}

/** A short stable hash of some text, used to give a generated card its id. */
export function hashOf(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

/** Picks from `items` with chances in proportion to `weightFor`. */
function weighted<T>(items: readonly T[], weightFor: (item: T) => number, rand: () => number): T | undefined {
  const total = items.reduce((sum, item) => sum + Math.max(0, weightFor(item)), 0)
  if (total <= 0) return items.at(Math.floor(rand() * items.length))
  let left = rand() * total
  for (const item of items) {
    left -= Math.max(0, weightFor(item))
    if (left < 0) return item
  }
  return items.at(-1)
}

/**
 * The next card. A topic is drawn by weight from the topics the remaining
 * cards cover; within it, a card due for review comes first one time in three,
 * else a card never seen, else any card not shown this session. Returns `null`
 * when nothing is left to show.
 */
export function pickCard(
  cards: readonly Card[],
  weights: Weights,
  progress: Progress,
  today: string,
  shown: ReadonlySet<string>,
  rand: () => number = Math.random,
): Card | null {
  const fresh = cards.filter(card => !shown.has(card.id))
  if (fresh.length === 0) return null

  const topics = [...new Set(fresh.map(card => card.topic))]
  const topic = weighted(topics, t => weightOf(weights, t), rand) ?? topics[0]
  const pool = fresh.filter(card => card.topic === topic)

  const due = pool.filter(card => {
    const p = progress[card.id]
    return p !== undefined && p.due <= today
  })
  const unseen = pool.filter(card => progress[card.id] === undefined)

  const roll = rand()
  const from = due.length > 0 && (roll < 1 / 3 || unseen.length === 0) ? due : unseen.length > 0 ? unseen : pool
  return from.at(Math.floor(rand() * from.length)) ?? null
}

/** Right answers out of answered cards, per topic, from the stored progress. */
export function accuracyByTopic(cards: readonly Card[], progress: Progress): Record<Topic, { asked: number; right: number }> {
  const out: Record<Topic, { asked: number; right: number }> = {}
  for (const card of cards) {
    const p = progress[card.id]
    if (!p || card.kind !== 'yesno') continue
    const row = out[card.topic] ?? { asked: 0, right: 0 }
    out[card.topic] = { asked: row.asked + p.seen, right: row.right + p.right }
  }
  return out
}
