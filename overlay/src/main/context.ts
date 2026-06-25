import { includedShots } from './screenshot'
export { includedShots }

export interface Turn {
  source: 'system' | 'mic'
  text: string
  t: number
}

// In-memory rolling store of dialogue turns
const turns: Turn[] = []
const MAX_TURNS = 2000

/**
 * Adds a transcribed speech turn to the ring buffer.
 */
export function addTurn(source: 'system' | 'mic', text: string): void {
  turns.push({ source, text, t: Date.now() })
  if (turns.length > MAX_TURNS) {
    turns.shift()
  }
}

/**
 * Returns a window of turns. If n is Infinity, returns all collected turns.
 */
export function getTurnsWindow(n: number): Turn[] {
  return n === Infinity ? turns : turns.slice(-n)
}

/**
 * Clears the collected dialogue turns ring buffer.
 */
export function clear(): void {
  turns.length = 0
}

