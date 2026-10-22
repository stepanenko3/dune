/* Типи сітки на вибування (сам модуль — ESM без TypeScript: його ж бере сервер). */
export type Pick = 'a' | 'b' | null
export interface Match { a: string | null; b: string | null; w: Pick; aBye: boolean; bBye: boolean; auto: boolean }
export function bracketSize(n: number): number
export function seedOf(ids: string[]): (string | null)[]
export function matchesOf(seed: (string | null)[], picks?: Pick[][]): { rounds: Match[][]; champion: string | null }
export function cleanPicks(seed: (string | null)[], picks: Pick[][]): Pick[][]
export function placesOf(seed: (string | null)[], picks: Pick[][]): string[][]
