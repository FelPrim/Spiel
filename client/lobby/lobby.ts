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

    // ================== Карта: UI-элементы ==================
    const loadMapBtn       = requireEl<HTMLButtonElement>('load-map');
    const mapFileInput     = requireEl<HTMLInputElement>('map-file');
    const mapStatus        = requireEl<HTMLDivElement>('map-status');
    const pickCountryBtn   = requireEl<HTMLButtonElement>('selection-mode');
    const viewport         = requireEl<HTMLDivElement>('viewport');

    const mapView = new MapView(viewport);
    mapView.onStatus(text => { mapStatus.textContent = text; });

    // ================== Состояние лобби (клиентская копия) ==================
    let myUsername: string | null = null;
    let lastParticipants: string[] = [];
    const countriesByUser = new Map<string, number>();   // username → tileId
    let pickingCountry = false;
    let lastMapVersion = -1;

    // ================== Рендер списка участников ==================
    function provinceColorHex(tileId: number): string | null {
        const info = mapView.loadedMapData?.info;
        if (!info || tileId < 0 || tileId >= info.colors.length) return null;
        const rgb = info.colors[tileId];
        return `#${rgb.toString(16).padStart(6, '0')}`;
    }

    function renderParticipants(): void {
        countEl.textContent = String(lastParticipants.length);
        listEl.innerHTML = '';
        for (const name of lastParticipants) {
            const li = document.createElement('li');

            const tileId = countriesByUser.get(name);
            const hex = tileId != null ? provinceColorHex(tileId) : null;
            if (hex) {
                const swatch = document.createElement('span');
                swatch.style.cssText =
                    'display:inline-block;width:10px;height:10px;' +
                    'border-radius:2px;margin-right:6px;vertical-align:middle;' +
                    'border:1px solid rgba(0,0,0,0.4);';
                swatch.style.background = hex;
                li.appendChild(swatch);
            }

            const label = tileId != null ? `${name} · #${tileId}` : name;
            li.appendChild(document.createTextNode(label));
            if (name === myUsername) {
                li.style.fontWeight = 'bold';
            }

            listEl.appendChild(li);
        }
    }

    function repaintCountries(): void {
        const list = Array.from(countriesByUser.values()).map(tileId => ({ tileId }));
        mapView.setCountries(list);
    }

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
            // Карта перерисована — восстановим оверлей стран и свотчи.
            repaintCountries();
            renderParticipants();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            mapStatus.textContent = 'Ошибка скачивания: ' + msg;
        }
    }

    // ================== Выбор страны ==================
    async function postCountry(tileId: number | null): Promise<void> {
        if (!LOBBY_CODE) return;
        try {
            const r = await fetch(`/lobby/${encodeURIComponent(LOBBY_CODE)}/country`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tileId }),
            });
            if (!r.ok) {
                let msg = `Ошибка ${r.status}`;
                try {
                    const j = await r.json() as { error?: string };
                    if (j && j.error) msg = j.error;
                } catch { /* нет тела */ }
                mapStatus.textContent = msg;
                return;
            }
            const j = await r.json() as { success: boolean; tileId: number | null };
            mapStatus.textContent = j.tileId != null
                ? `Выбрана страна #${j.tileId}`
                : 'Выбор страны снят';
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            mapStatus.textContent = 'Ошибка сети: ' + msg;
        }
    }

    mapView.onTileClick((tileId) => {
        if (!pickingCountry) return;
        // Визуально снимаем белую подсветку «курсора» — выбор страны
        // показывается отдельным цветным оверлеем.
        mapView.clearSelection();
        void postCountry(tileId);
    });

    pickCountryBtn.addEventListener('click', () => {
        pickingCountry = !pickingCountry;
        mapView.setSelectionMode(pickingCountry ? 'tile' : 'none');
        pickCountryBtn.classList.toggle('active', pickingCountry);
    });

    // ================== Подключение к лобби (SSE) ==================
    let eventSource: EventSource | null = null;

    async function fetchMe(): Promise<string | null> {
        try {
            const r = await fetch('/me');
            if (!r.ok) return null;
            const j = await r.json() as { user?: { username?: string } };
            return j.user?.username ?? null;
        } catch {
            return null;
        }
    }

    async function initLobby(): Promise<void> {
        myUsername = await fetchMe();
        if (!myUsername) { location.href = '../index.html'; return; }

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
                    lastParticipants = data.participants;
                    renderParticipants();
                    break;

                case 'mapVersion':
                    if (data.version !== lastMapVersion) {
                        lastMapVersion = data.version;
                        if (data.version > 0) {
                            void downloadAndApplyMap();
                        }
                    }
                    break;

                case 'countries': {
                    countriesByUser.clear();
                    for (const [u, t] of Object.entries(data.countries)) {
                        countriesByUser.set(u, t);
                    }
                    repaintCountries();
                    renderParticipants();
                    break;
                }

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