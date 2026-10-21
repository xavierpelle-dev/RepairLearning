import type { Card } from '../types'
import { GIT } from './git'
import { JAVASCRIPT } from './javascript'
import { PHP } from './php'

/** Every card RepairLearning ships. */
export const CARDS: readonly Card[] = [...JAVASCRIPT, ...PHP, ...GIT]
