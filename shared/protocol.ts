// shared/protocol.ts
import type { SerializedGameState, SerializedOrder } from './game';

export type SseEvent =
    | { type: 'participants'; participants: string[]; host: string | null; afk?: string[] }
    | { type: 'mapVersion'; version: number }
    | { type: 'countries'; countries: Array<[string, number]> }
    | { type: 'gameStart'; turn: number; youAreHost: boolean }
    | { type: 'turnStarted'; turn: number }
    | { type: 'ordersBatch'; from: string; orders: SerializedOrder[]; ready: boolean }
    | { type: 'allReady'; turn: number }
    | { type: 'turnResult'; turn: number; state: SerializedGameState }
    | { type: 'hostChanged'; host: string | null }
    | { type: 'historyInfo'; length: number };

export interface OrdersRequest {
    orders: SerializedOrder[];
    ready: boolean;
}
export interface WhoamiResponse {
    youAreHost: boolean;
    yourCountryIdx: number | null;
}