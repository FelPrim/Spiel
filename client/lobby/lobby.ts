// client/lobby/lobby.ts
import { MapView } from '../shared/mapview';

const LOBBY_CODE: string | null =
    new URLSearchParams(location.search).get('code') ||
    sessionStorage.getItem('lobbyCode');

interface LobbyEventData {
    participants?: string[];
    mapVersion?: number;
}

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
    // На этапе лобби на выбранный тайл мы отдельно не реагируем —
    // статус уже приходит через onStatus.
    // mapView.onTileClick(tileId => { ... });

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
        // 1. Проверяем, что сессия жива
        try {
            const r = await fetch('/me');
            if (!r.ok) { location.href = '../index.html'; return; }
        } catch {
            location.href = '../index.html';
            return;
        }

        // 2. Проверяем, что лобби реально существует
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

        // 3. Открываем SSE
        eventSource = new EventSource(`/lobby/${encodeURIComponent(LOBBY_CODE)}/events`);

        eventSource.onmessage = (e: MessageEvent<string>) => {
            try {
                const data = JSON.parse(e.data) as LobbyEventData;

                if (Array.isArray(data.participants)) {
                    renderParticipants(data.participants);
                }

                if (typeof data.mapVersion === 'number'
                        && data.mapVersion !== lastMapVersion) {
                    lastMapVersion = data.mapVersion;
                    if (data.mapVersion > 0) {
                        void downloadAndApplyMap();
                    }
                }
            } catch (err) {
                console.error('Не удалось разобрать сообщение SSE:', err);
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
            // При успехе ничего не делаем: сервер разошлёт SSE с новой
            // mapVersion, и мы (как и все остальные) скачаем и применим карту.
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            mapStatus.textContent = 'Ошибка сети: ' + msg;
        } finally {
            mapFileInput.value = '';
        }
    });
});