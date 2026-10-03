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
    | { type: 'turnResult'; turn: number;
        movementState: SerializedGameState | null;
        state: SerializedGameState;
        orders: SerializedOrder[] }
    | { type: 'hostChanged'; host: string | null }
    | { type: 'historyInfo'; length: number }
    | { type: 'renames'; renames: Array<[number, string]> };

export interface OrdersRequest {
    orders: SerializedOrder[];
    ready: boolean;
}

export interface WhoamiResponse {
    youAreHost: boolean;
    yourCountryIdx: number | null;
}

export interface HistoryEntry {
    turn: number;
    movement: SerializedGameState | null;
    final: SerializedGameState;
    orders: SerializedOrder[];
}

export interface HistoryResponse {
    entries: HistoryEntry[];
}