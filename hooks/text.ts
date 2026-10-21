/**
 * Every sentence RepairLearning shows that is not a card, in English and in
 * French. The cards carry their own French; these are the band's labels, the
 * command's replies and the end-of-turn summary.
 */
import type { Lang } from '../types'

export type Text = {
  yesOrNo: string
  right: string
  notQuite: string
  yes: string
  no: string
  next: string
  gotIt: string
  hide: string
  commandDescription: string
  paused: string
  resumed: string
  resetDone: string
  nothingYet: string
  pausedPrefix: string
  pauseHint: string
  resumeHint: string
  today: (count: number, goal: number) => string
  answered: (asked: number, right: number, pct: string) => string
  byTopic: (topics: string) => string
  available: (shipped: number, generated: number | null) => string
  goalReached: (goal: number) => string
  summary: (seen: number, right: number, asked: number, count: number, goal: number) => string
}

const EN: Text = {
  yesOrNo: ' · yes or no?',
  right: '**Right.**',
  notQuite: '**Not quite.**',
  yes: 'Yes',
  no: 'No',
  next: 'Next',
  gotIt: 'Got it',
  hide: 'Hide',
  commandDescription: 'RepairLearning: your learning stats, or pause, resume or reset the cards',
  paused: 'Paused. `/repairlearning resume` brings the cards back.',
  resumed: 'On. Cards appear while Claude works.',
  resetDone: 'Progress deleted: every card is new again, and today starts at 0.',
  nothingYet: 'nothing answered yet',
  pausedPrefix: 'Paused. ',
  pauseHint: '`/repairlearning pause` turns the cards off.',
  resumeHint: '`/repairlearning resume` turns the cards back on.',
  today: (count, goal) => `${count}/${goal} cards today.`,
  answered: (asked, right, pct) => `Questions answered: ${asked}, right: ${right} (${pct}).`,
  byTopic: topics => `By topic: ${topics}.`,
  available: (shipped, generated) =>
    `Cards available: ${shipped} shipped${generated === null ? ' (generation off)' : `, ${generated} generated`}.`,
  goalReached: goal => `RepairLearning: daily goal of ${goal} cards reached. Nice work.`,
  summary: (seen, right, asked, count, goal) => {
    const cards = `${seen} card${seen === 1 ? '' : 's'}`
    const score = asked > 0 ? `, ${right}/${asked} right` : ''
    return `RepairLearning: ${cards} this turn${score} · ${count}/${goal} today`
  },
}

const FR: Text = {
  yesOrNo: ' · oui ou non ?',
  right: '**Exact.**',
  notQuite: '**Pas tout à fait.**',
  yes: 'Oui',
  no: 'Non',
  next: 'Suivante',
  gotIt: 'Compris',
  hide: 'Masquer',
  commandDescription: 'RepairLearning : tes stats, ou mettre en pause, reprendre ou remettre à zéro',
  paused: 'En pause. `/repairlearning resume` ramène les cartes.',
  resumed: 'Activé. Les cartes apparaissent pendant que Claude travaille.',
  resetDone: 'Progression effacée : toutes les cartes redeviennent nouvelles, et aujourd’hui repart de 0.',
  nothingYet: 'aucune réponse pour l’instant',
  pausedPrefix: 'En pause. ',
  pauseHint: '`/repairlearning pause` coupe les cartes.',
  resumeHint: '`/repairlearning resume` remet les cartes.',
  today: (count, goal) => `${count}/${goal} cartes aujourd’hui.`,
  answered: (asked, right, pct) => `Questions répondues : ${asked}, justes : ${right} (${pct}).`,
  byTopic: topics => `Par sujet : ${topics}.`,
  available: (shipped, generated) =>
    `Cartes disponibles : ${shipped} fournies${generated === null ? ' (génération coupée)' : `, ${generated} générées`}.`,
  goalReached: goal => `RepairLearning : objectif du jour de ${goal} cartes atteint. Bravo.`,
  summary: (seen, right, asked, count, goal) => {
    const cards = `${seen} carte${seen === 1 ? '' : 's'}`
    const score = asked > 0 ? `, ${right}/${asked} justes` : ''
    return `RepairLearning : ${cards} ce tour${score} · ${count}/${goal} aujourd’hui`
  },
}

export const TEXT: Readonly<Record<Lang, Text>> = { en: EN, fr: FR }
