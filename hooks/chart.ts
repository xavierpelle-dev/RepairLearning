/**
 * Text charts for the command's replies: a filled bar and a sparkline, built
 * from block characters so they draw in any terminal.
 */

const SPARKS = '▁▂▃▄▅▆▇█'

/** A bar `width` cells wide, filled to `fraction` (clamped to 0..1). */
export function bar(fraction: number, width = 20): string {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

/** One cell per value, scaled to the largest; a zero is a dot, so gaps show. */
export function sparkline(values: readonly number[]): string {
  const top = Math.max(0, ...values)
  return values
    .map(v => (v <= 0 || top === 0 ? '·' : SPARKS[Math.min(SPARKS.length - 1, Math.ceil((v / top) * SPARKS.length) - 1)]))
    .join('')
}

/** Pads `label` to `width` so the bars after it line up. */
export function pad(label: string, width: number): string {
  return label.length >= width ? label : label + ' '.repeat(width - label.length)
}
