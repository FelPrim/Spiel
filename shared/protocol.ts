// shared/protocol.ts
import type { Order, SerializedGameState } from './game';

export type SseEvent =
    | { type: 'participants'; participants: string[]; host: string | null }
    | { type: 'mapVersion'; version: number }
    | { type: 'countries'; countries: Record<string, number> }   // ← НОВОЕ
    | { type: 'gameStart'; turn: number; youAreHost: boolean }
    | { type: 'turnStarted'; turn: number }
    | { type: 'ordersBatch'; from: string; orders: Order[]; ready: boolean }
    | { type: 'allReady'; turn: number }
    | { type: 'turnResult'; turn: number; state: SerializedGameState }
    | { type: 'hostChanged'; host: string | null }
    | { type: 'historyInfo'; length: number };

export interface OrdersRequest {
    orders: Order[];
    ready: boolean;
}