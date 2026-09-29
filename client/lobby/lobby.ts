// client/lobby/lobby.ts
import { MapView } from '../shared/mapview';
import type { SseEvent } from '../../shared/protocol';

const LOBBY_CODE: string | null =
    new URLSearchParams(location.search).get('code') ||
    sessionStorage.getItem('lobbyCode');

function requireEl<T extends HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Элемент #${id} не найден`);
    return el as T;
}

document.addEventListener('DOMContentLoaded', () => {

    // ================== Участники (SSE) ==================
    const codeDisplay = requireEl<HTMLSpanElement>('lobby-code-display');
    const countEl     = requireEl<HTMLSpanElement>('participants-count');
    const listEl      = requireEl<HTMLUListElement>('participants-list');

    codeDisplay.textContent = LOBBY_CODE || '—';

    function renderParticipants(names: string[]): void {
        countEl.textContent = String(names.length);
        listEl.innerHTML = '';
        for (const name of names) {
            const li = document.createElement('li');
            li.textContent = name;
            listEl.appendChild(li);
        }
    }

    // ================== Карта: UI-элементы ==================
    const loadMapBtn       = requireEl<HTMLButtonElement>('load-map');
    const mapFileInput     = requireEl<HTMLInputElement>('map-file');
    const mapStatus        = requireEl<HTMLDivElement>('map-status');
    const selectionModeBtn = requireEl<HTMLButtonElement>('selection-mode');
    const viewport         = requireEl<HTMLDivElement>('viewport');

    const mapView = new MapView(viewport);
    mapView.onStatus(text => { mapStatus.textContent = text; });

    // ================== Скачивание карты из лобби ==================
    async function downloadAndApplyMap(): Promise<void> {
        if (!LOBBY_CODE) return;
        mapStatus.textContent = 'Загрузка карты из лобби...';
        try {
            const r = await fetch(`/lobby/${encodeURIComponent(LOBBY_CODE)}/map`);
            if (!r.ok) {
                mapStatus.textContent = `Не удалось скачать карту: ${r.status}`;
                return;
            }
            const blob = await r.blob();
            await mapView.loadFromBlob(blob);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            mapStatus.textContent = 'Ошибка скачивания: ' + msg;
        }
    }

    // ================== Подключение к лобби (SSE) ==================
    let eventSource: EventSource | null = null;
    let lastMapVersion = -1;

    async function initLobby(): Promise<void> {
        try {
            const r = await fetch('/me');
            if (!r.ok) { location.href = '../index.html'; return; }
        } catch {
            location.href = '../index.html';
            return;
        }

        if (!LOBBY_CODE) { location.href = '../index.html'; return; }

        try {
            const r = await fetch(`/lobby/${encodeURIComponent(LOBBY_CODE)}/join`, {
                method: 'POST'
            });
            if (!r.ok) {
                location.href = '../index.html';
                return;
            }
        } catch {
            location.href = '../index.html';
            return;
        }

        eventSource = new EventSource(`/lobby/${encodeURIComponent(LOBBY_CODE)}/events`);

        eventSource.onmessage = (e: MessageEvent<string>) => {
            let data: SseEvent;
            try {
                data = JSON.parse(e.data) as SseEvent;
            } catch (err) {
                console.error('Не удалось разобрать сообщение SSE:', err);
                return;
            }

            switch (data.type) {
                case 'participants':
                    renderParticipants(data.participants);
                    break;

                case 'mapVersion':
                    if (data.version !== lastMapVersion) {
                        lastMapVersion = data.version;
                        if (data.version > 0) {
                            void downloadAndApplyMap();
                        }
                    }
                    break;

                case 'gameStart':
                case 'turnStarted':
                case 'ordersBatch':
                case 'allReady':
                case 'turnResult':
                case 'hostChanged':
                case 'historyInfo':
                    // Лобби на игровые события пока не реагирует.
                    break;

                default: {
                    // exhaustive check: если появится новый тип — TS напомнит.
                    const _exhaustive: never = data;
                    console.warn('Неизвестное SSE-событие:', _exhaustive);
                }
            }
        };

        eventSource.onerror = () => {
            console.warn('SSE: соединение с лобби потеряно, попытка переподключения...');
        };

        window.addEventListener('beforeunload', () => {
            if (eventSource) eventSource.close();
        });
    }

    void initLobby();

    // ================== Кнопки ==================
    loadMapBtn.addEventListener('click', () => {
        mapFileInput.click();
    });

    selectionModeBtn.addEventListener('click', () => {
        const enabled = !mapView.selectionMode;
        mapView.setSelectionMode(enabled ? 'tile' : 'none');
        selectionModeBtn.classList.toggle('active', enabled);
    });

    // ================== Загрузка архива → отправка в лобби ==================
    mapFileInput.addEventListener('change', async () => {
        if (!LOBBY_CODE) return;
        const file = mapFileInput.files?.[0];
        if (!file) return;

        if (!file.name.toLowerCase().endsWith('.spielmap')) {
            mapStatus.textContent = 'Ошибка: файл должен иметь расширение .spielmap';
            mapFileInput.value = '';
            return;
        }

        mapStatus.textContent = 'Отправка карты в лобби...';
        try {
            const r = await fetch(
                `/lobby/${encodeURIComponent(LOBBY_CODE)}/map`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/octet-stream' },
                    body: file,
                }
            );
            if (!r.ok) {
                let msg = `Ошибка ${r.status}`;
                try {
                    const j = await r.json() as { error?: string };
                    if (j && j.error) msg = j.error;
                } catch { /* нет тела */ }
                mapStatus.textContent = msg;
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            mapStatus.textContent = 'Ошибка сети: ' + msg;
        } finally {
            mapFileInput.value = '';
        }
    });
});