/**
 * The game layer on top of the cards: experience points, levels, a streak of
 * days in a row, the best day so far, and badges for topics you have
 * mastered. Pure functions of the stored score, so they are tested directly.
 */
import type { Topic } from '../types'
import { addDays } from './planner'

/** What is kept in $.store under `score`, shared by every session. */
export type Score = {
  xp: number
  /** Days in a row with at least one card, ending on `lastDay`. */
  streak: number
  bestStreak: number
  /** The last day (YYYY-MM-DD) a card was seen, or null before the first. */
  lastDay: string | null
  /** The most cards seen in one day. */
  bestDay: number
}

/** A right answer is worth more than a fact read or a wrong answer. */
export const XP_RIGHT = 3
export const XP_SEEN = 1

/** A badge needs this many answers in a topic, at this accuracy or better. */
export const BADGE_ANSWERS = 20
export const BADGE_PERCENT = 80

export function freshScore(): Score {
  return { xp: 0, streak: 0, bestStreak: 0, lastDay: null, bestDay: 0 }
}

/** Reads a stored score back, starting fresh from anything malformed. */
export function readScore(stored: unknown): Score {
  if (typeof stored !== 'object' || stored === null) return freshScore()
  const s = stored as Partial<Score>
  const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0)
  return {
    xp: count(s.xp),
    streak: count(s.streak),
    bestStreak: count(s.bestStreak),
    lastDay: typeof s.lastDay === 'string' ? s.lastDay : null,
    bestDay: count(s.bestDay),
  }
}

/**
 * Level 1 at 0 XP, then each level costs more than the last: level 2 at
 * 10 XP, 3 at 40, 4 at 90, 10 at 810.
 */
export function levelOf(xp: number): number {
  return Math.floor(Math.sqrt(xp / 10)) + 1
}

/** The XP at which `level` starts. */
export function xpForLevel(level: number): number {
  return 10 * (level - 1) ** 2
}

/** Counts one card seen today; `dayCount` is today's total including it. */
export function addCard(before: Score, isRight: boolean | null, today: string, dayCount: number): Score {
  const streak = before.lastDay === today
    ? before.streak
    : before.lastDay === addDays(today, -1) ? before.streak + 1 : 1
  return {
    xp: before.xp + (isRight === true ? XP_RIGHT : XP_SEEN),
    streak,
    bestStreak: Math.max(before.bestStreak, streak),
    lastDay: today,
    bestDay: Math.max(before.bestDay, dayCount),
  }
}

/** The streak as it stands today: still alive until a whole day is missed. */
export function liveStreak(score: Score, today: string): number {
  return score.lastDay === today || score.lastDay === addDays(today, -1) ? score.streak : 0
}

/** Topics answered often enough and well enough to earn a badge, best first. */
export function badges(byTopic: Readonly<Record<Topic, { asked: number; right: number }>>): Topic[] {
  return Object.entries(byTopic)
    .filter(([, row]) => row.asked >= BADGE_ANSWERS && row.right * 100 >= row.asked * BADGE_PERCENT)
    .sort((a, b) => b[1].right / b[1].asked - a[1].right / a[1].asked)
    .map(([topic]) => topic)
}
