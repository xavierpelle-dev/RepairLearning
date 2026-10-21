/**
 * A topic a card belongs to, as a lowercase slug such as `python`, `rust` or
 * `kubernetes`. The set is open: the session's tool calls name the topic, and
 * a generated card can carry one no pack ships.
 */
export type Topic = string

/** The language cards and the band are shown in. */
export type Lang = 'en' | 'fr'

/**
 * One learning card. A `fact` is read and dismissed; a `yesno` is answered
 * with 1 (yes) or 2 (no) and then explained.
 */
export type Card = {
  id: string
  topic: Topic
  kind: 'fact' | 'yesno'
  text: string
  /** The right answer of a `yesno` card. */
  answer?: boolean
  /** One or two short sentences, shown after a `yesno` is answered. */
  explain?: string
  /** `pack` for a card this plugin ships, `ai` for one a model wrote. */
  source?: 'pack' | 'ai'
  /** A shipped card's French text and explanation, shown when French is on. */
  fr?: { text: string; explain?: string }
  /** The language a generated card was written in; English when missing. */
  lang?: Lang
}

/** What the band shows after a `yesno` card is answered. */
export type Feedback = { isRight: boolean; text: string }

/** Cards seen and answered right during the current Claude turn. */
export type TurnTally = { seen: number; asked: number; right: number }

declare module 'claude-code' {
  interface PluginState {
    repairlearning: {
      card: Card | null
      feedback: Feedback | null
      needsYou: boolean
      tally: TurnTally
    }
  }
}
