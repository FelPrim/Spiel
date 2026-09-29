// shared/protocol.ts
//
// Типы, пересекающие границу клиент↔сервер.
// Рантайм-кода здесь нет — только `type`/`interface`.

import type { Order, SerializedGameState } from './game';

// ---------------------------------------------------------------------------
// SSE-события
// ---------------------------------------------------------------------------
//
// Целевой формат: сервер шлёт
//     data: {"type":"participants","participants":[...],"host":"alice"}\n\n
//
// ВАЖНО: пока (до отдельного этапа миграции server.js) сервер шлёт
// одно событие вида {"participants":[...],"mapVersion":0} — без поля `type`.
// Значит, парсить это как SseEvent на клиенте пока нельзя: `type` будет
// undefined. Здесь SseEvent — это целевая форма, к которой мы приведём
// сервер и клиент на следующем этапе.

export type SseEvent =
    | { type: 'participants'; participants: string[]; host: string | null }
    | { type: 'mapVersion'; version: number }
    | { type: 'gameStart'; turn: number; youAreHost: boolean }
    | { type: 'turnStarted'; turn: number }
    | { type: 'ordersBatch'; from: string; orders: Order[]; ready: boolean }
    | { type: 'allReady'; turn: number }
    | { type: 'turnResult'; turn: number }
    | { type: 'hostChanged'; host: string | null }
    | { type: 'historyInfo'; length: number };

// `SerializedGameState` уже сейчас тянется из общего модуля: он понадобится,
// как только `turnResult` (или отдельное событие `stateSnapshot`) начнёт
// нести снимок состояния. Держим импорт здесь, чтобы сигнатура была
// «заявлена» с самого начала.

// ---------------------------------------------------------------------------
// HTTP-запросы
// ---------------------------------------------------------------------------

export interface OrdersRequest {
    orders: Order[];
    ready: boolean;
}