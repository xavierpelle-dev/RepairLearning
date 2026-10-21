import { describe, expect, test } from 'claude-code/testing'

import { addCard, badges, freshScore, levelOf, liveStreak, readScore, xpForLevel, XP_RIGHT, XP_SEEN } from './score'

describe('levels', () => {
  test('start at 1 and get further apart', () => {
    expect(levelOf(0)).toBe(1)
    expect(levelOf(9)).toBe(1)
    expect(levelOf(10)).toBe(2)
    expect(levelOf(40)).toBe(3)
    expect(levelOf(810)).toBe(10)
  })

  test('xpForLevel is where levelOf turns over', () => {
    for (let level = 1; level < 30; level += 1) {
      expect(levelOf(xpForLevel(level))).toBe(level)
      expect(levelOf(xpForLevel(level + 1) - 1)).toBe(level)
    }
  })
})

describe('addCard', () => {
  test('a right answer earns more than a read fact or a wrong answer', () => {
    const start = freshScore()
    expect(addCard(start, true, '2026-10-02', 1).xp).toBe(XP_RIGHT)
    expect(addCard(start, false, '2026-10-02', 1).xp).toBe(XP_SEEN)
    expect(addCard(start, null, '2026-10-02', 1).xp).toBe(XP_SEEN)
  })

  test('the streak grows one per day in a row, and once per day only', () => {
    let s = addCard(freshScore(), null, '2026-10-01', 1)
    s = addCard(s, null, '2026-10-01', 2)
    expect(s.streak).toBe(1)
    s = addCard(s, null, '2026-10-02', 1)
    expect(s.streak).toBe(2)
    expect(s.bestStreak).toBe(2)
  })

  test('a missed day restarts the streak but keeps the best one', () => {
    let s = addCard(freshScore(), null, '2026-10-01', 1)
    s = addCard(s, null, '2026-10-02', 1)
    s = addCard(s, null, '2026-10-05', 1)
    expect(s.streak).toBe(1)
    expect(s.bestStreak).toBe(2)
  })

  test('the best day only goes up', () => {
    const s = addCard({ ...freshScore(), bestDay: 30 }, null, '2026-10-02', 3)
    expect(s.bestDay).toBe(30)
    expect(addCard(s, null, '2026-10-02', 31).bestDay).toBe(31)
  })
})

describe('liveStreak', () => {
  test('survives until a whole day is missed', () => {
    const s = { ...freshScore(), streak: 4, lastDay: '2026-10-01' }
    expect(liveStreak(s, '2026-10-01')).toBe(4)
    expect(liveStreak(s, '2026-10-02')).toBe(4)
    expect(liveStreak(s, '2026-10-03')).toBe(0)
  })
})

describe('badges', () => {
  test('need enough answers at a high enough rate', () => {
    expect(badges({
      php: { asked: 20, right: 16 },
      git: { asked: 50, right: 49 },
      javascript: { asked: 19, right: 19 },
      rust: { asked: 40, right: 20 },
    })).toEqual(['git', 'php'])
  })
})

describe('readScore', () => {
  test('starts fresh from anything malformed', () => {
    expect(readScore(undefined)).toEqual(freshScore())
    expect(readScore({ xp: -5, streak: 'x', lastDay: 3 })).toEqual(freshScore())
    expect(readScore({ xp: 12, streak: 2, bestStreak: 3, lastDay: '2026-10-01', bestDay: 9 }).xp).toBe(12)
  })
})
