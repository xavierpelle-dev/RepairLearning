import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { MockClock } from 'claude-code/testing'

const NOW = Date.parse('2026-10-02T10:00:00Z')

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

/**
 * The engine's own answers beneath the plugin, for the events a turn raises.
 * `reply` stands in for what a model would write; by default it answers
 * nothing, so a test gets pack cards only and stays deterministic.
 */
function engine(on: On, store: Record<string, unknown> = {}, reply: string | null = null): MockClock {
  mock.store(on, store)
  const clock = mock.clock(on, { now: NOW })
  // $.model.complete is an event like any other, so the test answers it
  // instead of reaching the Claude API.
  on('model.complete', () => ({
    value: reply === null ? { isAnswered: false, reason: 'no model in this test' } : { isAnswered: true, text: reply },
  }) as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  // Core resolves turn.complete to `{ text }`, and for a main-loop turn that
  // text is the answer itself. A mod returning a different text has it shown
  // beneath the answer; returning core's result unchanged adds nothing.
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('classic.Notification', () => ({}))
  on('classic.PermissionRequest', () => ({}))
  on('ui.toast', () => ({ value: undefined }) as never)
  // The engine draws nothing of its own in the band.
  on('ui.render', () => ({ type: 'engine', ref: 0 }) as never)
  return clock
}

const complete = { answer: 'Done.', reason: 'answer', durationMs: 1000, isAborted: false, turnId: 't1' } as const
const command = (args: string) => ({ command: 'repairlearning', args, origin: { kind: 'composer' }, presentation: {} }) as never

test('a turn shows a card, takes an answer, and ends with a summary', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'fix the login bug', turnId: 't1' })

  const ui = await $.ui.mount({ plugin: 'repairlearning', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'hide' })).toBeDefined()

  // A question takes 1 for yes and then shows Next; a fact takes 1 for Got it.
  if (await ui.find({ key: 'yes' })) {
    await ui.press({ key: 'yes' })
    expect(await ui.find({ key: 'next' })).toBeDefined()
    expect(await ui.find({ type: 'Markdown', text: /Right\.|Not quite\./ })).toBeDefined()
  } else {
    await ui.press({ key: 'next' })
  }
  await ui.unmount()

  const done = await $.turn.complete(complete as never)
  expect(done.text).toMatch(/^RepairLearning: 1 card this turn/)
  expect(done.text).toMatch(/1\/20 today$/)
})

test('a question from Claude hides the card until Claude starts new work', async ($, on) => {
  const clock = engine(on)
  await $.turn.start({ text: 'deploy it', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'repairlearning', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'hide' })).toBeDefined()

  await $.classic.Notification({ notification_type: 'elicitation_dialog', message: 'Claude has a question' })
  await ui.redraw()
  expect(await ui.find({ key: 'hide' })).toBeUndefined()

  await clock.advance(5000)
  await $.tool.call({ tool: 'Read', file_path: 'app.py', tool_use_id: 'toolu_1' } as never)
  await ui.redraw()
  expect(await ui.find({ key: 'hide' })).toBeDefined()
  await ui.unmount()
})

test('a parallel tool finishing does not bring the card back during a permission prompt', async ($, on) => {
  const clock = engine(on)
  await $.turn.start({ text: 'publish', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'repairlearning', surface: 'terminal', ...BAND })

  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'npm publish' } } as never)
  await ui.redraw()
  expect(await ui.find({ key: 'hide' })).toBeUndefined()

  // Another call already in flight finishes: still waiting on the person.
  await $.tool.call({ tool: 'Read', file_path: 'package.json', tool_use_id: 'toolu_2' } as never)
  await ui.redraw()
  expect(await ui.find({ key: 'hide' })).toBeUndefined()

  // The approved call itself finishes: Claude carries on.
  await clock.settle()
  await $.tool.call({ tool: 'Bash', command: 'npm publish', tool_use_id: 'toolu_1' } as never)
  await ui.redraw()
  expect(await ui.find({ key: 'hide' })).toBeDefined()
  await ui.unmount()
})

test('a double press counts once', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'one', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'repairlearning', surface: 'terminal', ...BAND })
  const key = (await ui.find({ key: 'yes' })) ? 'yes' : 'next'
  await Promise.allSettled([ui.press({ key }), ui.press({ key })])
  await ui.unmount()

  const done = await $.turn.complete(complete as never)
  expect(done.text).toMatch(/^RepairLearning: 1 card this turn/)
})

test('nothing shows when Claude is idle, and a turn with no card says nothing', async ($, on) => {
  engine(on)
  const idle = await $.ui.mount({ plugin: 'repairlearning', surface: 'terminal', ...BAND, props: { ...BAND.props, isWorking: false } })
  expect(await idle.find({ key: 'hide' })).toBeUndefined()
  await idle.unmount()

  await $.turn.start({ text: 'quick one', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'repairlearning', surface: 'terminal', ...BAND })
  await ui.press({ key: 'hide' })
  expect(await ui.find({ key: 'yes' })).toBeUndefined()
  await ui.unmount()

  const done = await $.turn.complete(complete as never)
  // Core's own text, unchanged: nothing is shown beneath the answer.
  expect(done.text).toBe('Done.')
})

test('the daily goal stops new cards', { options: { daily_goal: 1 } }, async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'one', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'repairlearning', surface: 'terminal', ...BAND })
  if (await ui.find({ key: 'yes' })) {
    await ui.press({ key: 'no' })
  }
  await ui.press({ key: 'next' })
  expect(await ui.find({ key: 'hide' })).toBeUndefined()
  await ui.unmount()
})

test('progress another session saved is kept when this one saves', async ($, on) => {
  // Another session answered this question three times, all right.
  const other = { 'git-rebase-hashes': { box: 3, due: '2026-10-06', seen: 3, right: 3 } }
  engine(on, { progress: other })
  await $.turn.start({ text: 'one', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'repairlearning', surface: 'terminal', ...BAND })
  await ui.press({ key: (await ui.find({ key: 'yes' })) ? 'yes' : 'next' })
  await ui.unmount()

  // Stats read what this session saved: the other session's 3 answers survive.
  const stats = await $.command.run(command('stats'))
  const answered = Number(/Questions answered: (\d+)/.exec(stats.text ?? '')?.[1])
  expect(answered).toBeGreaterThan(2)
})

test('/repairlearning reset deletes saved progress', async ($, on) => {
  engine(on, { progress: { 'git-bisect': { box: 1, due: '2026-10-03', seen: 1, right: 0 } }, day: { date: '2026-10-02', count: 4 } })
  const before = await $.command.run(command(''))
  expect(before.text).toMatch(/^4\/20 cards today\./)

  const reply = await $.command.run(command('reset'))
  expect(reply.text).toMatch(/Progress deleted/)

  const after = await $.command.run(command(''))
  expect(after.text).toMatch(/^0\/20 cards today\./)
  expect(after.text).toMatch(/Questions answered: 0,/)
})

test('/repairlearning reset clears the card on screen and the tally', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'one', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'repairlearning', surface: 'terminal', ...BAND })
  await ui.press({ key: (await ui.find({ key: 'yes' })) ? 'yes' : 'next' })

  // A card is on screen, either the answered one or the next one.
  expect(await ui.find({ key: 'hide' })).toBeDefined()
  await $.command.run(command('reset'))
  await ui.redraw()
  expect(await ui.find({ key: 'hide' })).toBeUndefined()
  await ui.unmount()

  // The tally went with it, so the turn adds no line beneath the answer.
  const done = await $.turn.complete(complete as never)
  expect(done.text).toBe('Done.')
})

test('a card a model wrote joins the library and is counted in the stats', async ($, on) => {
  const made = JSON.stringify([
    { kind: 'fact', text: '`cargo add serde` edits `Cargo.toml` for you.' },
    { kind: 'yesno', text: 'Does `cargo build` write to `target/`?', answer: true, explain: 'Yes, that is the default output directory.' },
  ])
  const clock = engine(on, {}, made)
  await $.turn.start({ text: 'port it to rust', turnId: 't1' })

  // Working on a .rs file points the session at Rust, which no pack covers.
  await $.tool.call({ tool: 'Read', file_path: 'src/main.rs', tool_use_id: 'toolu_1' } as never)
  // The refill is queued on a timer, so nothing has been asked for yet.
  const before = await $.command.run(command(''))
  expect(before.text).toMatch(/0 generated/)

  await clock.advance(5000)
  await clock.settle()

  const after = await $.command.run(command(''))
  expect(after.text).toMatch(/2 generated/)
})

test('a model that answers nothing leaves the packs working', async ($, on) => {
  const clock = engine(on)
  await $.turn.start({ text: 'port it to rust', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: 'src/main.rs', tool_use_id: 'toolu_1' } as never)
  await clock.advance(5000)
  await clock.settle()

  const ui = await $.ui.mount({ plugin: 'repairlearning', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'hide' })).toBeDefined()
  await ui.unmount()

  const stats = await $.command.run(command(''))
  expect(stats.text).toMatch(/0 generated/)
})

test('pausing stops cards across turns, and resuming brings them back', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'one', turnId: 't1' })
  await $.command.run(command('pause'))

  await $.turn.start({ text: 'two', turnId: 't2' })
  const paused = await $.ui.mount({ plugin: 'repairlearning', surface: 'terminal', ...BAND })
  expect(await paused.find({ key: 'hide' })).toBeUndefined()
  await paused.unmount()

  await $.command.run(command('resume'))
  await $.turn.start({ text: 'three', turnId: 't3' })
  const back = await $.ui.mount({ plugin: 'repairlearning', surface: 'terminal', ...BAND })
  expect(await back.find({ key: 'hide' })).toBeDefined()
  await back.unmount()
})

test('generation turned off keeps the packs and asks no model', { options: { ai_cards: false } }, async ($, on) => {
  const clock = engine(on, {}, JSON.stringify([{ kind: 'fact', text: 'Never asked for.' }]))
  await $.turn.start({ text: 'port it to rust', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: 'src/main.rs', tool_use_id: 'toolu_1' } as never)
  await clock.advance(60_000)
  await clock.settle()

  const ui = await $.ui.mount({ plugin: 'repairlearning', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'hide' })).toBeDefined()
  await ui.unmount()

  const stats = await $.command.run(command(''))
  expect(stats.text).toMatch(/generation off/)
})

test('a subagent turn adds no summary, even after a card was answered', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'one', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'repairlearning', surface: 'terminal', ...BAND })
  await ui.press({ key: (await ui.find({ key: 'yes' })) ? 'yes' : 'next' })
  await ui.unmount()

  // There is a summary to add, so the agentId guard is what keeps it away.
  const done = await $.turn.complete({ ...complete, agentId: 'a1' } as never)
  expect(done.text).toBe('Done.')
})

test('French turns the band, the summary and the stats into French', { options: { french: true } }, async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'corrige le bug', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'repairlearning', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'hide', label: 'Masquer' })).toBeDefined()
  if (await ui.find({ key: 'yes' })) {
    await ui.press({ key: 'yes' })
    expect(await ui.find({ type: 'Markdown', text: /Exact\.|Pas tout à fait\./ })).toBeDefined()
  } else {
    await ui.press({ key: 'next' })
  }
  await ui.unmount()

  const done = await $.turn.complete(complete as never)
  expect(done.text).toMatch(/^RepairLearning : 1 carte ce tour/)
  const stats = await $.command.run(command(''))
  expect(stats.text).toMatch(/^1\/20 cartes aujourd’hui\./)
})

test('French asks the model for French cards, and keeps English ones out', { options: { french: true } }, async ($, on) => {
  const made = JSON.stringify([{ kind: 'fact', text: '`cargo add serde` modifie `Cargo.toml` pour toi.' }])
  const english = { id: 'ai-rust-old', topic: 'rust', kind: 'fact', text: 'An English card.', source: 'ai' }
  const clock = engine(on, { library: [english] }, made)
  await $.turn.start({ text: 'porte-le en rust', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: 'src/main.rs', tool_use_id: 'toolu_1' } as never)
  await clock.advance(5000)
  await clock.settle()
  const stats = await $.command.run(command(''))
  expect(stats.text).toMatch(/1 générées/)
})

test('answering earns XP and a streak, shown by top and share', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'one', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'repairlearning', surface: 'terminal', ...BAND })
  await ui.press({ key: (await ui.find({ key: 'yes' })) ? 'yes' : 'next' })
  await ui.unmount()

  const top = await $.command.run(command('top'))
  expect(top.text).toMatch(/^Level 1 · [13] XP/)
  expect(top.text).toMatch(/Streak: 1 day/)
  const share = await $.command.run(command('share'))
  expect(share.text).toMatch(/RepairLearning · level 1 \([13] XP\) · streak 1 day · /)
})

test('reset clears the score too', async ($, on) => {
  engine(on, { score: { xp: 500, streak: 9, bestStreak: 9, lastDay: '2026-10-02', bestDay: 40 } })
  expect((await $.command.run(command('top'))).text).toMatch(/^Level 8 · 500 XP/)
  await $.command.run(command('reset'))
  expect((await $.command.run(command('top'))).text).toMatch(/^Level 1 · 0 XP/)
})

test('records and share speak French when French is on', { options: { french: true } }, async ($, on) => {
  engine(on, { score: { xp: 90, streak: 3, bestStreak: 5, lastDay: '2026-10-02', bestDay: 12 } })
  expect((await $.command.run(command('top'))).text).toMatch(/^Niveau 4 · 90 XP \(encore 70 pour le niveau suivant\)/)
  expect((await $.command.run(command('share'))).text).toMatch(/niveau 4 \(90 XP\) · série de 3 jours/)
})
