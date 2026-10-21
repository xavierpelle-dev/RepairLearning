import type { Card } from '../types'
import { GIT } from './git'
import { JAVASCRIPT } from './javascript'
import { PHP } from './php'
import { SYMFONY } from './symfony'
import { VUE } from './vue'

/** Every card RepairLearning ships. */
export const CARDS: readonly Card[] = [...JAVASCRIPT, ...VUE, ...PHP, ...SYMFONY, ...GIT]
