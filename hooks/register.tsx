/**
 * RepairLearning: short learning cards in the band above the prompt while Claude
 * works. A card appears when a turn starts, steps aside whenever Claude needs
 * the person, and the turn ends with a one-line summary under Claude's answer.
 *
 * The decisions (which card, how an answer is graded) live in planner.ts;
 * this module connects them to Claude Code's events and draws the band.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Card, Feedback, Lang, Topic, TurnTally } from '../types'
import { CARDS } from '../content'
import { BATCH_TOKENS, buildPrompt, MODEL, parseCards, SYSTEM, TIMEOUT_MS } from '../content/generate'
import {
  accuracyByTopic, bump, dayOf, decay, freshWeights, grade, inLang, isAnswered, isInLang, keyOf, labelOf,
  pickCard, PROJECT_FILES, seed, topicOf,
} from './planner'
import type { Ask, Progress, Weights } from './planner'
import { avoidFor, merge, needsRefill, readLibrary, topicToFill } from './pool'
import { bar, pad, sparkline } from './chart'
import { addCard, badges, lastDays, levelOf, liveStreak, readScore, xpForLevel } from './score'
import { TEXT } from './text'
import type { Records } from './text'

const cardAtom = atom({ plugin: 'repairlearning', key: 'card' } as const, null)
const feedbackAtom = atom({ plugin: 'repairlearning', key: 'feedback' } as const, null)
const needsYouAtom = atom({ plugin: 'repairlearning', key: 'needsYou' } as const, false)
const tallyAtom = atom({ plugin: 'repairlearning', key: 'tally' } as const, { seen: 0, asked: 0, right: 0 })

/** How long after a topic goes quiet before its cards are generated. */
const REFILL_DELAY_MS = 1500

/**
 * How long before the same topic may be asked about again. A model that
 * returns few usable cards leaves the topic short, so without this the next
 * tool call would queue another paid request, and so would the one after it.
 */
const RETRY_MS = 5 * 60_000

/** Notifications that mean Claude is waiting on the person. */
const NEEDS_YOU = new Set(['permission_prompt', 'agent_needs_input', 'elicitation_dialog', 'elicitation_url_dialog'])

type DayCount = { date: string; count: number }

/**
 * The session's bookkeeping, set up again on every load. Progress lives in
 * $.store, which every Claude Code session on the machine shares, so it is
 * read again right before each write; what the band draws lives in $.state.
 */
const session = {
  lang: 'en' as Lang,
  /** The shipped packs in `lang`, translated once per load. */
  packs: CARDS as readonly Card[],
  dailyGoal: 20,
  maxPerTurn: 5,
  weights: freshWeights() as Weights,
  progress: {} as Progress,
  isPaused: false,
  isHiddenThisTurn: false,
  /** Cards shown this session, never offered again until the next one. */
  shown: new Set<string>(),
  /** The card on screen that has not been answered yet. */
  unanswered: null as string | null,
  /** What Claude is waiting on the person for, while it waits. */
  ask: null as Ask | null,
  /**
   * Set while a press is being handled. Checked and set before anything
   * awaits, so a second press of the same key cannot count twice.
   */
  isBusy: false,
  /** Whether cards may be generated. Off makes RepairLearning pack-only and offline. */
  isAiOn: true,
  /** Generated cards, shared with every session through $.store. */
  library: [] as Card[],
  /** Set while a batch is being generated, so only one is in flight. */
  isGenerating: false,
  /** The pending background refill, cancelled when a newer topic arrives. */
  refill: null as { cancel: () => void } | null,
  /** When each topic was last asked about, so a short reply cannot loop. */
  triedAt: {} as Record<Topic, number>,
}

/** The interface sentences in the session's language. */
function text() {
  return TEXT[session.lang]
}

/** The generated cards written in the session's language. */
function libraryInLang(): Card[] {
  return session.library.filter(card => isInLang(card, session.lang))
}

/** Everything that can be shown: the shipped packs and what a model wrote. */
function allCards(): readonly Card[] {
  const library = libraryInLang()
  return library.length === 0 ? session.packs : [...session.packs, ...library]
}

/** Takes the press lock; false when another press is still being handled. */
function lock(): boolean {
  if (session.isBusy) return false
  session.isBusy = true
  return true
}

function unlock(): void {
  session.isBusy = false
}

async function today($: EngineInterface): Promise<string> {
  return dayOf(await $.clock.now())
}

async function readDay($: EngineInterface): Promise<DayCount> {
  const stored = (await $.store.get('day')) as DayCount | undefined
  const date = await today($)
  return stored && stored.date === date ? stored : { date, count: 0 }
}

/**
 * Asks a model for a batch of cards on one topic and keeps the ones fit to
 * show. Runs off a timer, never on the path between a turn starting and the
 * first card, so a slow or failed request costs the person nothing but a
 * pack card instead of a generated one. Time inside $.model.complete does
 * not count against a hook's limit, so there is no rush here.
 */
async function generate($: EngineInterface, topic: Topic): Promise<void> {
  if (!session.isAiOn || session.isGenerating) return
  session.isGenerating = true
  try {
    // Stamped here, where the request is really made, rather than where it is
    // queued: a queued refill can be cancelled by a newer topic, and that
    // topic was never asked about, so it must not be held back.
    session.triedAt[topic] = await $.clock.now()
    const reply = await $.model.complete({
      model: MODEL,
      system: SYSTEM,
      prompt: buildPrompt(topic, avoidFor(libraryInLang(), session.packs, topic), session.lang),
      maxTokens: BATCH_TOKENS,
      timeoutMs: TIMEOUT_MS,
    })
    // A Claude API failure resolves rather than rejects, so this is the check.
    if (!reply.isAnswered) return
    const made = parseCards(topic, reply.text, session.lang)
    if (made.length === 0) return
    // Another session may have generated since this one last read.
    const stored = readLibrary(await $.store.get('library'))
    session.library = merge(stored, made)
    await $.store.set('library', session.library)
  } catch {
    // A model the organization blocks, or no credentials: stay on the packs.
  } finally {
    session.isGenerating = false
  }
}

/**
 * Queues a refill for the topic the session leans towards, if that topic is
 * running short. Called as tool calls come in, so it is debounced: only the
 * last topic of a burst is generated for.
 */
async function queueRefill($: EngineInterface): Promise<void> {
  if (!session.isAiOn || session.isGenerating) return
  const topic = topicToFill(session.weights)
  if (!needsRefill(libraryInLang(), topic, session.shown)) return
  const tried = session.triedAt[topic]
  if (tried !== undefined && (await $.clock.now()) - tried < RETRY_MS) return
  session.refill?.cancel()
  // Awaited because the mods API may hand back the timer through a promise;
  // awaiting a plain timer is harmless either way.
  session.refill = await $.clock.after(REFILL_DELAY_MS, () => generate($, topic))
}

/** Shows the next card, or nothing when a cap is reached or learning is off. */
async function showNext($: EngineInterface): Promise<void> {
  const tally = await read($, tallyAtom)
  const day = await readDay($)
  const isCapped = tally.seen >= session.maxPerTurn || day.count >= session.dailyGoal
  const isOff = session.isPaused || session.isHiddenThisTurn || isCapped
  const card = isOff ? null : pickCard(allCards(), session.weights, session.progress, day.date, session.shown)
  if (card) session.shown.add(card.id)
  session.unanswered = card?.id ?? null
  await update($, feedbackAtom, () => null)
  await update($, cardAtom, () => card)
}

/**
 * Records a seen card: grades it on top of what the store holds now (another
 * session may have written since), counts it for today, and saves both.
 */
async function record($: EngineInterface, card: Card, isRight: boolean | null): Promise<void> {
  const date = await today($)
  const stored = ((await $.store.get('progress')) as Progress | undefined) ?? {}
  session.progress = grade(stored, card, isRight, date)
  await $.store.set('progress', session.progress)

  // Read the count as late as possible, so the gap between reading it and
  // writing it back is as short as $.store allows. There is no atomic
  // increment, so two sessions answering at the same moment can still lose a
  // count; the cap it feeds is a soft one, so that is acceptable.
  const day = await readDay($)
  const counted: DayCount = { date: day.date, count: day.count + 1 }
  await $.store.set('day', counted)

  // Read again right before writing, like progress: another session may have
  // scored since. A level shows a toast once, in the session that crosses it.
  const before = readScore(await $.store.get('score'))
  const after = addCard(before, isRight, date, counted.count)
  await $.store.set('score', after)
  if (levelOf(after.xp) > levelOf(before.xp)) $.ui.toast(text().levelUp(levelOf(after.xp)))

  session.unanswered = null
  await update($, tallyAtom, t => ({
    seen: t.seen + 1,
    asked: t.asked + (isRight === null ? 0 : 1),
    right: t.right + (isRight === true ? 1 : 0),
  }))
  // Toast on the card that carries the count over the goal, not on an exact
  // match: another session's write can take it past the goal in one step.
  if (day.count < session.dailyGoal && counted.count >= session.dailyGoal) {
    $.ui.toast(text().goalReached(session.dailyGoal))
  }
}

/** True while `card` is still the one on screen and not yet answered. */
async function isCurrent($: EngineInterface, card: Card): Promise<boolean> {
  const shownCard = await read($, cardAtom)
  return shownCard?.id === card.id && (await read($, feedbackAtom)) === null
}

// A second press can arrive before the band redraws: each handler takes the
// lock before it awaits anything, and checks the card it was drawn for is
// still the one on screen.

async function answer($: EngineInterface, card: Card, said: boolean): Promise<void> {
  if (!lock()) return
  try {
    if (!(await isCurrent($, card))) return
    const isRight = said === card.answer
    const feedback: Feedback = { isRight, text: card.explain ?? '' }
    await update($, feedbackAtom, () => feedback)
    await record($, card, isRight)
  } finally {
    unlock()
  }
}

async function moveOn($: EngineInterface, card: Card): Promise<void> {
  if (!lock()) return
  try {
    if ((await read($, cardAtom))?.id !== card.id) return
    if (session.unanswered === card.id) await record($, card, null)
    await showNext($)
  } finally {
    unlock()
  }
}

async function hide($: EngineInterface): Promise<void> {
  if (!lock()) return
  try {
    session.isHiddenThisTurn = true
    forgetUnanswered()
    await update($, cardAtom, () => null)
  } finally {
    unlock()
  }
}

/** A card the person never answered may come back later in the session. */
function forgetUnanswered(): void {
  if (session.unanswered) session.shown.delete(session.unanswered)
  session.unanswered = null
}

/** Days shown in the activity sparkline. */
const SPARK_DAYS = 14

async function statsText($: EngineInterface): Promise<string> {
  const day = await readDay($)
  const score = readScore(await $.store.get('score'))
  const byTopic = accuracyByTopic(allCards(), session.progress)
  const rows = Object.entries(byTopic).sort((a, b) => b[1].asked - a[1].asked)
  const asked = rows.reduce((n, [, row]) => n + row.asked, 0)
  const right = rows.reduce((n, [, row]) => n + row.right, 0)
  const level = levelOf(score.xp)
  const floor = xpForLevel(level)
  const ceiling = xpForLevel(level + 1)
  const badged = new Set(badges(byTopic))
  const t = text()
  // Only the topics actually answered, most answered first: the set is open
  // now, so listing every topic that exists would be a wall of dashes.
  const shown = rows.slice(0, 6)
  const width = Math.max(0, ...shown.map(([topic]) => labelOf(topic).length)) + 2
  const topics = shown.length === 0
    ? [t.byTopic(t.nothingYet)]
    : [t.byTopicTitle, ...shown.map(([topic, row]) =>
        `  ${pad(`${badged.has(topic) ? '★ ' : ''}${labelOf(topic)}`, width)} ${bar(row.right / row.asked, 14)} ${pct(row.right, row.asked).padStart(4)} (${row.asked})`)]
  return [
    `${session.isPaused ? t.pausedPrefix : ''}${t.today(day.count, session.dailyGoal)}  ${bar(day.count / session.dailyGoal)}`,
    `${t.level(level, score.xp)}  ${bar((score.xp - floor) / (ceiling - floor))}  ${t.toNext(level + 1, ceiling - score.xp)}`,
    `${t.lastDays(SPARK_DAYS)}  ${sparkline(lastDays(score, day.date, SPARK_DAYS))}  ${t.streak(liveStreak(score, day.date))}`,
    '',
    t.answered(asked, right, pct(right, asked)),
    ...topics,
    '',
    t.available(session.packs.length, session.isAiOn ? libraryInLang().length : null),
    session.isPaused ? t.resumeHint : t.pauseHint,
  ].join('\n')
}

const pct = (r: number, a: number): string => (a === 0 ? '-' : `${Math.round((100 * r) / a)}%`)

/** Everything `/repairlearning top` and `share` show. */
async function recordsOf($: EngineInterface): Promise<Records> {
  const score = readScore(await $.store.get('score'))
  const byTopic = accuracyByTopic(allCards(), session.progress)
  const rows = Object.values(byTopic)
  const asked = rows.reduce((n, row) => n + row.asked, 0)
  const right = rows.reduce((n, row) => n + row.right, 0)
  const level = levelOf(score.xp)
  return {
    level,
    xp: score.xp,
    toNext: xpForLevel(level + 1) - score.xp,
    streak: liveStreak(score, await today($)),
    bestStreak: score.bestStreak,
    bestDay: score.bestDay,
    accuracy: pct(right, asked),
    badges: badges(byTopic).map(labelOf),
  }
}

async function setPaused($: EngineInterface, isPaused: boolean): Promise<void> {
  session.isPaused = isPaused
  await $.store.set('paused', isPaused)
  if (isPaused) {
    forgetUnanswered()
    await update($, cardAtom, () => null)
  }
}

async function reset($: EngineInterface): Promise<void> {
  await $.store.delete('progress')
  await $.store.delete('day')
  await $.store.delete('library')
  await $.store.delete('score')
  session.progress = {}
  session.shown.clear()
  // Generated cards are saved data too, so "start fresh" drops them as well.
  // The next topic signal fills the library again, right away rather than
  // after the usual wait between requests.
  session.library = []
  session.triedAt = {}
  // Leave no card or count behind: one still on screen would be graded onto
  // the progress that was just deleted, and this turn's tally would describe
  // cards that no longer count towards anything.
  forgetUnanswered()
  const fresh: TurnTally = { seen: 0, asked: 0, right: 0 }
  await update($, cardAtom, () => null)
  await update($, feedbackAtom, () => null)
  await update($, tallyAtom, () => fresh)
}

async function startTurn($: EngineInterface): Promise<void> {
  session.isHiddenThisTurn = false
  session.ask = null
  session.weights = decay(session.weights)
  const fresh: TurnTally = { seen: 0, asked: 0, right: 0 }
  await update($, tallyAtom, () => fresh)
  await update($, needsYouAtom, () => false)
  await showNext($)
}

async function setNeedsYou($: EngineInterface, needsYou: boolean): Promise<void> {
  if ((await read($, needsYouAtom)) !== needsYou) await update($, needsYouAtom, () => needsYou)
}

async function waitForYou($: EngineInterface, tool: string, key: string): Promise<void> {
  session.ask = { tool, key, at: await $.clock.now() }
  await setNeedsYou($, true)
}

async function noteCall($: EngineInterface, call: { tool: string; key: string; startedAt: number }, isFinished: boolean): Promise<void> {
  if (session.ask && isAnswered(session.ask, call, isFinished)) {
    session.ask = null
    await setNeedsYou($, false)
  }
}

async function now($: EngineInterface): Promise<number> {
  return $.clock.now()
}

/** Clears the band and says how the turn went, or nothing if no card was seen. */
async function endTurn($: EngineInterface): Promise<string | null> {
  const tally = await read($, tallyAtom)
  forgetUnanswered()
  session.ask = null
  await update($, cardAtom, () => null)
  await update($, feedbackAtom, () => null)
  await setNeedsYou($, false)
  if (tally.seen === 0) return null
  const day = await readDay($)
  return text().summary(tally.seen, tally.right, tally.asked, day.count, session.dailyGoal)
}

async function load($: EngineInterface): Promise<void> {
  await $.command.register({
    name: 'repairlearning',
    description: text().commandDescription,
    argumentHint: '[stats | top | share | pause | resume | reset]',
    immediate: true,
  })
  session.progress = ((await $.store.get('progress')) as Progress | undefined) ?? {}
  session.isPaused = (await $.store.get('paused')) === true
  session.library = readLibrary(await $.store.get('library'))
  const found: Topic[] = []
  for (const [file, topic] of PROJECT_FILES) {
    if (await $.fs.exists(file)) found.push(topic)
  }
  session.weights = seed(freshWeights(), found)
  // Fill the library for what this project is written in, before the first
  // turn needs a card. Only the timer is awaited, not the generation itself,
  // so the session starts right away.
  await queueRefill($)
}

export const register: Register = (on, options) => {
  session.lang = options['french'] === true ? 'fr' : 'en'
  session.packs = CARDS.map(card => inLang(card, session.lang))
  session.dailyGoal = Number(options['daily_goal'] ?? 20)
  session.maxPerTurn = Number(options['max_per_turn'] ?? 5)
  session.isAiOn = options['ai_cards'] !== false
  session.weights = freshWeights()
  session.shown = new Set<string>()
  session.unanswered = null
  session.ask = null
  session.isBusy = false
  session.library = []
  session.isGenerating = false
  session.refill = null
  session.triedAt = {}

  on('session.start', async ($, e, next) => {
    await load($)
    return next(e)
  })

  on('command.run', { command: 'repairlearning' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'pause') {
      await setPaused($, true)
      return { text: text().paused }
    }
    if (arg === 'resume') {
      await setPaused($, false)
      return { text: text().resumed }
    }
    if (arg === 'top') return { text: text().records(await recordsOf($)) }
    if (arg === 'share') return { text: `${text().shareHint}\n\n${text().share(await recordsOf($))}` }
    if (arg === 'reset') {
      await reset($)
      return { text: text().resetDone }
    }
    return { text: await statsText($) }
  })

  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    await startTurn($)
    return started
  })

  // Every tool call says something about the session's topic, and tells
  // whether Claude has moved on from a question it put to the person.
  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Readonly<Record<string, unknown>>
    const topic = topicOf(e.tool, input)
    if (topic) {
      session.weights = bump(session.weights, topic)
      await queueRefill($)
    }
    const call = { tool: e.tool, key: keyOf(input), startedAt: await now($) }
    await noteCall($, call, false)
    const ran = await next(e)
    await noteCall($, call, true)
    return ran
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    await waitForYou($, e.tool_name, keyOf((e.tool_input ?? {}) as Readonly<Record<string, unknown>>))
    return next(e)
  })

  on('classic.Notification', async ($, e, next) => {
    if (NEEDS_YOU.has(e.notification_type)) await waitForYou($, '', '')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId) return done
    const summary = await endTurn($)
    return summary ? { ...done, text: summary } : done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !e.props.isWorking || e.props.view.agentId) return next(e)
    const card = await read($, cardAtom)
    const feedback = await read($, feedbackAtom)
    const needsYou = await read($, needsYouAtom)
    if (needsYou || !card) return next(e)

    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    const t = text()
    const isAsking = card.kind === 'yesno' && !feedback
    const title = `RepairLearning · ${labelOf(card.topic)}${isAsking ? t.yesOrNo : ''}`
    const body = feedback ? `${feedback.isRight ? t.right : t.notQuite} ${feedback.text}` : card.text

    // The buttons share the first row with the title: a band shorter than the
    // card scrolls, and a bare digit only presses a button in view.
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={3}>
          <Text dimColor>{title}</Text>
          {isAsking && <Button key="yes" label={t.yes} hotkey="1" plain onPress={() => answer($, card, true)} />}
          {isAsking && <Button key="no" label={t.no} hotkey="2" plain onPress={() => answer($, card, false)} />}
          {!isAsking && <Button key="next" label={feedback ? t.next : t.gotIt} hotkey="1" plain onPress={() => moveOn($, card)} />}
          <Button key="hide" label={t.hide} hotkey="9" plain dimColor onPress={() => hide($)} />
        </Box>
        <Markdown text={body} />
      </Box>
    )
  })
}
