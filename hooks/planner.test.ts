import { describe, expect, test } from 'claude-code/testing'

import { CARDS } from '../content'
import type { Card } from '../types'
import {
  addDays, bump, decay, freshWeights, grade, hashOf, inLang, isAnswered, isInLang, isValidCard, keyOf, labelOf,
  leadingTopic, pickCard, seed, topicOf, weightOf, BASE_WEIGHT, MAX_TEXT, PACK_TOPICS,
} from './planner'

const DAY = '2026-10-02'

/** A fixed sequence of "random" numbers, repeating its last one. */
function rolls(...values: number[]): () => number {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)] ?? 0
}

const fact = (id: string, topic = 'git'): Card => ({ id, topic, kind: 'fact', text: id })

describe('topicOf', () => {
  test('reads the topic from a file extension', () => {
    expect(topicOf('Edit', { file_path: 'src/app.tsx' })).toBe('javascript')
    expect(topicOf('Read', { file_path: 'C:\\work\\api\\main.py' })).toBe('python')
    expect(topicOf('Write', { file_path: 'repo/.gitignore' })).toBe('git')
    expect(topicOf('Read', { file_path: 'notes.md' })).toBe(null)
  })

  test('reads topics the packs do not cover', () => {
    expect(topicOf('Edit', { file_path: 'src/main.rs' })).toBe('rust')
    expect(topicOf('Read', { file_path: 'infra/main.tf' })).toBe('terraform')
    expect(topicOf('Read', { file_path: 'Dockerfile' })).toBe('docker')
    expect(topicOf('Bash', { command: 'cargo test' })).toBe('rust')
    expect(topicOf('Bash', { command: 'kubectl get pods' })).toBe('kubernetes')
  })

  test('reads the topic from the program a command runs', () => {
    expect(topicOf('Bash', { command: 'cd api && pytest -q' })).toBe('python')
    expect(topicOf('Bash', { command: 'CI=1 npm test' })).toBe('javascript')
    expect(topicOf('Bash', { command: 'git rebase -i HEAD~3' })).toBe('git')
    expect(topicOf('Bash', { command: 'ls -la' })).toBe(null)
  })
})

describe('weights', () => {
  test('an unseen topic is worth the base weight', () => {
    expect(weightOf(freshWeights(), 'haskell')).toBe(BASE_WEIGHT)
  })

  test('a signal raises its topic, and decay fades it but never below the base', () => {
    const bumped = bump(freshWeights(), 'python')
    expect(bumped.python).toBe(BASE_WEIGHT + 1)
    const faded = decay(decay(decay(decay(decay(decay(decay(decay(decay(decay(bumped))))))))))
    expect(weightOf(faded, 'python')).toBeGreaterThan(BASE_WEIGHT - 0.0001)
    expect(weightOf(faded, 'git')).toBe(BASE_WEIGHT)
  })

  test('the leading topic is the one with the most signal, or none at all', () => {
    expect(leadingTopic(freshWeights())).toBe(null)
    expect(leadingTopic(bump(bump(freshWeights(), 'rust'), 'go'))).toBe('rust')
  })
})

describe('project files and asks', () => {
  test('seeding raises each found topic once', () => {
    const seeded = seed(freshWeights(), ['javascript', 'javascript', 'python'])
    expect(seeded).toEqual({ javascript: BASE_WEIGHT + 1, python: BASE_WEIGHT + 1 })
    expect(weightOf(seeded, 'git')).toBe(BASE_WEIGHT)
  })

  test('keyOf picks the field that identifies a call', () => {
    expect(keyOf({ command: 'npm publish', description: 'x' })).toBe('npm publish')
    expect(keyOf({ file_path: 'a.ts', old_string: 'x' })).toBe('a.ts')
    expect(keyOf({})).toBe('')
  })

  test('an ask is answered when its own call finishes, or new work starts after it', () => {
    const ask = { tool: 'Bash', key: 'npm publish', at: 100 }
    expect(isAnswered(ask, { tool: 'Read', key: 'a.ts', startedAt: 50 }, true)).toBe(false)
    expect(isAnswered(ask, { tool: 'Bash', key: 'npm publish', startedAt: 50 }, true)).toBe(true)
    expect(isAnswered(ask, { tool: 'Read', key: 'a.ts', startedAt: 150 }, false)).toBe(true)
    expect(isAnswered(ask, { tool: 'Read', key: 'a.ts', startedAt: 100 }, false)).toBe(false)
  })

  test('a question has no call of its own: only new work answers it', () => {
    const question = { tool: '', key: '', at: 100 }
    expect(isAnswered(question, { tool: 'Bash', key: '', startedAt: 50 }, true)).toBe(false)
    expect(isAnswered(question, { tool: 'Bash', key: '', startedAt: 200 }, false)).toBe(true)
  })
})

describe('labels', () => {
  test('a known topic gets its proper name, and any other is capitalized', () => {
    expect(labelOf('javascript')).toBe('JavaScript')
    expect(labelOf('csharp')).toBe('C#')
    expect(labelOf('elixir')).toBe('Elixir')
  })
})

describe('grade', () => {
  const card: Card = { id: 'q', topic: 'git', kind: 'yesno', text: 'q?', answer: true, explain: 'x' }

  test('a right answer moves a card up a box and pushes it further out', () => {
    const once = grade({}, card, true, DAY)
    expect(once['q']).toEqual({ box: 1, due: addDays(DAY, 1), seen: 1, right: 1 })
    const twice = grade(once, card, true, DAY)
    expect(twice['q']).toEqual({ box: 2, due: addDays(DAY, 2), seen: 2, right: 2 })
  })

  test('a wrong answer sends a card back to box 1', () => {
    let p = grade({}, card, true, DAY)
    p = grade(p, card, true, DAY)
    p = grade(p, card, false, DAY)
    expect(p['q']?.box).toBe(1)
    expect(p['q']?.right).toBe(2)
  })

  test('a read fact moves up without counting as an answer', () => {
    const p = grade({}, fact('f'), null, DAY)
    expect(p['f']).toEqual({ box: 1, due: addDays(DAY, 1), seen: 1, right: 0 })
  })
})

describe('pickCard', () => {
  const cards = [fact('a'), fact('b'), fact('c')]

  test('never repeats a card already shown this session', () => {
    expect(pickCard(cards, freshWeights(), {}, DAY, new Set(['a', 'b']))?.id).toBe('c')
    expect(pickCard(cards, freshWeights(), {}, DAY, new Set(['a', 'b', 'c']))).toBe(null)
  })

  test('prefers a card never seen over one seen before', () => {
    const progress = { a: { box: 3, due: addDays(DAY, 5), seen: 3, right: 0 }, b: { box: 3, due: addDays(DAY, 5), seen: 3, right: 0 } }
    expect(pickCard(cards, freshWeights(), progress, DAY, new Set(), rolls(0, 0.9, 0))?.id).toBe('c')
  })

  test('brings back a due card one time in three', () => {
    const progress = { a: { box: 1, due: DAY, seen: 1, right: 0 } }
    expect(pickCard(cards, freshWeights(), progress, DAY, new Set(), rolls(0, 0.1, 0))?.id).toBe('a')
    expect(pickCard(cards, freshWeights(), progress, DAY, new Set(), rolls(0, 0.9, 0))?.id).not.toBe('a')
  })

  test('draws the topic by weight', () => {
    const mixed = [fact('g', 'git'), fact('p', 'python'), fact('j', 'javascript')]
    const weights = { javascript: 0, python: 10, git: 0 }
    expect(pickCard(mixed, weights, {}, DAY, new Set(), rolls(0.5, 0.5, 0))?.id).toBe('p')
  })

  test('draws a topic no pack covers, when a card for it exists', () => {
    const mixed = [fact('g', 'git'), fact('r', 'rust')]
    const weights = { rust: 10 }
    expect(pickCard(mixed, weights, {}, DAY, new Set(), rolls(0.9, 0.5, 0))?.id).toBe('r')
  })
})

describe('isValidCard', () => {
  const good: Card = { id: 'x', topic: 'rust', kind: 'yesno', text: 'Is this a question?', answer: true, explain: 'Yes, it ends with a question mark.' }

  test('accepts a well formed card of each kind', () => {
    expect(isValidCard(good)).toBe(true)
    expect(isValidCard({ id: 'y', topic: 'rust', kind: 'fact', text: 'A fact.' })).toBe(true)
  })

  test('rejects what the band cannot show', () => {
    expect(isValidCard(null)).toBe(false)
    expect(isValidCard({ ...good, text: 'No question mark' })).toBe(false)
    expect(isValidCard({ ...good, answer: 'yes' })).toBe(false)
    expect(isValidCard({ ...good, explain: 'short' })).toBe(false)
    expect(isValidCard({ ...good, text: `${'a'.repeat(MAX_TEXT)}?` })).toBe(false)
    expect(isValidCard({ ...good, kind: 'essay' })).toBe(false)
    expect(isValidCard({ id: 'z', topic: 'rust', kind: 'fact', text: 'A fact.', answer: true })).toBe(false)
  })
})

describe('hashOf', () => {
  test('the same text always hashes the same, and different text differs', () => {
    expect(hashOf('hello')).toBe(hashOf('hello'))
    expect(hashOf('hello')).not.toBe(hashOf('hellp'))
  })
})

describe('content', () => {
  test('every card id is unique', () => {
    expect(new Set(CARDS.map(card => card.id)).size).toBe(CARDS.length)
  })

  test('every shipped card passes the same check a generated one has to', () => {
    for (const card of CARDS) {
      expect(isValidCard(card)).toBe(true)
    }
  })

  test('every shipped card has a French version that passes the same check', () => {
    for (const card of CARDS) {
      expect(card.fr === undefined).toBe(false)
      expect(card.kind === 'yesno' ? card.fr?.explain !== undefined : card.fr?.explain === undefined).toBe(true)
      expect(isValidCard(inLang(card, 'fr'))).toBe(true)
    }
  })

  test('French text replaces the English but keeps the id, and English is left alone', () => {
    const card = CARDS.find(c => c.kind === 'yesno')
    if (!card) throw new Error('no question shipped')
    expect(inLang(card, 'fr').id).toBe(card.id)
    expect(inLang(card, 'fr').text).toBe(card.fr?.text)
    expect(inLang(card, 'en')).toBe(card)
  })

  test('a generated card stored without a language counts as English', () => {
    const card: Card = { id: 'g', topic: 'rust', kind: 'fact', text: 'A fact.' }
    expect(isInLang(card, 'en')).toBe(true)
    expect(isInLang({ ...card, lang: 'fr' }, 'en')).toBe(false)
  })

  test('each topic has facts and questions, and answers are not all one way', () => {
    for (const topic of PACK_TOPICS) {
      const mine = CARDS.filter(card => card.topic === topic)
      const yes = mine.filter(card => card.answer === true).length
      const no = mine.filter(card => card.answer === false).length
      expect(mine.filter(card => card.kind === 'fact').length).toBeGreaterThan(9)
      expect(yes).toBeGreaterThan(2)
      expect(no).toBeGreaterThan(2)
      // Neither answer may fall below a third of a topic's questions, or
      // always guessing the commoner one would score well without learning
      // anything. Integer arithmetic, so a topic sitting exactly on a third
      // still passes.
      expect(Math.min(yes, no) * 3).toBeGreaterThan(yes + no - 1)
    }
  })
})
