// ================== Подключение к лобби (SSE) ==================
(function () {
    const codeDisplay = document.getElementById('lobby-code-display');
    const countEl = document.getElementById('participants-count');
    const listEl = document.getElementById('participants-list');

    const lobbyCode =
        new URLSearchParams(location.search).get('code') ||
        sessionStorage.getItem('lobbyCode');

    if (codeDisplay) codeDisplay.textContent = lobbyCode || '—';

    function renderParticipants(names) {
        countEl.textContent = names.length;
        listEl.innerHTML = '';
        for (const name of names) {
            const li = document.createElement('li');
            li.textContent = name;
            listEl.appendChild(li);
        }
    }

    let eventSource = null;

    async function init() {
        // 1. Проверяем, что сессия жива
        try {
			const r = await fetch('/me');
			if (!r.ok) { location.href = '../index.html'; return; }
		} catch (_) { location.href = '../index.html'; return; }

		// 2. Проверяем, что лобби реально существует
		if (!lobbyCode) { location.href = '../index.html'; return; }

		try {
			const r = await fetch(`/lobby/${encodeURIComponent(lobbyCode)}/join`, {
				method: 'POST'
			});
			if (!r.ok) {
				// лобби нет или код неверного формата — назад на главную
				location.href = '../index.html';
				return;
			}
		} catch (_) { location.href = '../index.html'; return; }

        // 3. Открываем SSE — именно этот момент считаем «входом в лобби»
        eventSource = new EventSource(`/lobby/${encodeURIComponent(lobbyCode)}/events`);

        eventSource.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                if (Array.isArray(data.participants)) {
                    renderParticipants(data.participants);
                }
            } catch (err) {
                console.error('Не удалось разобрать сообщение SSE:', err);
            }
        };

        eventSource.onerror = () => {
            // EventSource сам переподключится. Если лобби исчезло — сервер вернёт 404,
            // и браузер будет молча ретраить; при желании здесь можно добавить
            // отдельную проверку через fetch('/lobby/:code/join') и редирект.
            console.warn('SSE: соединение с лобби потеряно, попытка переподключения...');
        };

        // Закрываем поток при уходе со страницы — сервер сразу выкинет нас из списка
        window.addEventListener('beforeunload', () => {
            if (eventSource) eventSource.close();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();


document.addEventListener('DOMContentLoaded', () => {
    const loadMapBtn = document.getElementById('load-map');
    const mapFileInput = document.getElementById('map-file');
    const mapDisplay = document.getElementById('map-display');
    const mapStatus = document.getElementById('map-status');
    const selectionModeBtn = document.getElementById('selection-mode');
    const viewport = document.getElementById('viewport');

    let loadedMapData = null;

    // Состояние вида (аналог editor)
    const view = {
        scale: 1,
        translateX: 0,
        translateY: 0,
        isPanning: false,
        panStartX: 0,
        panStartY: 0,
        panLastX: 0,
        panLastY: 0,
        pendingDown: null,
        selectionMode: false
    };

    function applyTransform() {
        mapDisplay.style.transform =
            `translate(${view.translateX}px, ${view.translateY}px) scale(${view.scale})`;
    }

    function fitToScreen() {
        if (!loadedMapData) return;
        const { W, H } = loadedMapData;
        const vw = viewport.clientWidth;
        const vh = viewport.clientHeight;
        view.scale = Math.min(vw / W, vh / H, 1);
        view.translateX = (vw - W * view.scale) / 2;
        view.translateY = (vh - H * view.scale) / 2;
        applyTransform();
    }

    function zoomAt(cx, cy, factor) {
        const newScale = Math.min(Math.max(view.scale * factor, 0.05), 20);
        const ratio = newScale / view.scale;
        view.translateX = cx - (cx - view.translateX) * ratio;
        view.translateY = cy - (cy - view.translateY) * ratio;
        view.scale = newScale;
        applyTransform();
    }

    function updateCursor() {
        if (view.isPanning) {
            viewport.style.cursor = 'grabbing';
        } else if (view.selectionMode) {
            viewport.style.cursor = 'crosshair';
        } else {
            viewport.style.cursor = 'grab';
        }
    }

    // ===== Кнопки =====

    loadMapBtn.addEventListener('click', () => {
        mapFileInput.click();
    });

    selectionModeBtn.addEventListener('click', () => {
        view.selectionMode = !view.selectionMode;
        selectionModeBtn.classList.toggle('active', view.selectionMode);
        updateCursor();
    });

    // ===== Загрузка архива =====

    mapFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.name.toLowerCase().endsWith('.spielmap')) {
            mapStatus.textContent = 'Ошибка: файл должен иметь расширение .spielmap';
            return;
        }

        mapStatus.textContent = 'Загрузка...';

        try {
            const zip = await JSZip.loadAsync(file);

            const mapEntryName = Object.keys(zip.files).find(name => name.startsWith('map.'));
            if (!mapEntryName) throw new Error('В архиве не найден файл карты (map.*)');

            const mapBlob = await zip.file(mapEntryName).async('blob');
            const mapUrl = URL.createObjectURL(mapBlob);

            const voronojEntry = zip.file('voronoj.png');
            if (!voronojEntry) throw new Error('В архиве не найден файл voronoj.png');
            const voronojBlob = await voronojEntry.async('blob');
            const voronojUrl = URL.createObjectURL(voronojBlob);

            const infoEntry = zip.file('info.json');
            if (!infoEntry) throw new Error('В архиве не найден файл info.json');
            const infoText = await infoEntry.async('text');
            const info = JSON.parse(infoText);

            const voronojImg = new Image();
            voronojImg.src = voronojUrl;
            await new Promise((resolve, reject) => {
                voronojImg.onload = resolve;
                voronojImg.onerror = reject;
            });
            URL.revokeObjectURL(voronojUrl);

            const voronojCanvas = document.createElement('canvas');
            const W = voronojCanvas.width = voronojImg.naturalWidth;
            const H = voronojCanvas.height = voronojImg.naturalHeight;
            const vctx = voronojCanvas.getContext('2d', { willReadFrequently: true });
            vctx.drawImage(voronojImg, 0, 0);

            const imageData = vctx.getImageData(0, 0, W, H);
            const data = imageData.data;
            const voronojData32 = new Uint32Array(W * H);
            for (let i = 0, j = 0; i < data.length; i += 4, j++) {
                voronojData32[j] = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
            }

            // Кэш индексов пикселей по цвету провинции
            const provinceIndices = new Map();
            {
                const tmp = new Map();
                for (let i = 0; i < voronojData32.length; i++) {
                    const c = voronojData32[i];
                    let arr = tmp.get(c);
                    if (!arr) { arr = []; tmp.set(c, arr); }
                    arr.push(i);
                }
                for (const [c, arr] of tmp) {
                    provinceIndices.set(c, Uint32Array.from(arr));
                }
            }

            const overlayCanvas = document.createElement('canvas');
            overlayCanvas.id = 'map-overlay';
            overlayCanvas.width = W;
            overlayCanvas.height = H;
            overlayCanvas.style.position = 'absolute';
            overlayCanvas.style.top = '0';
            overlayCanvas.style.left = '0';
            overlayCanvas.style.pointerEvents = 'none';
            const overlayCtx = overlayCanvas.getContext('2d');

            const overlayImageData = overlayCtx.createImageData(W, H);
            const odata = overlayImageData.data;
            let lastPaintedIndices = null;

            function boundsOf(indices) {
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (let k = 0; k < indices.length; k++) {
                    const i = indices[k];
                    const x = i % W;
                    const y = (i / W) | 0;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
                return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
            }

            function unionBounds(a, b) {
                if (!a) return b;
                if (!b) return a;
                const x = Math.min(a.x, b.x);
                const y = Math.min(a.y, b.y);
                const x2 = Math.max(a.x + a.w, b.x + b.w);
                const y2 = Math.max(a.y + a.h, b.y + b.h);
                return { x, y, w: x2 - x, h: y2 - y };
            }

            function setSelection(newIndices) {
                const oldB = lastPaintedIndices ? boundsOf(lastPaintedIndices) : null;
                const newB = newIndices ? boundsOf(newIndices) : null;
                const dirty = unionBounds(oldB, newB);
                if (!dirty) return;

                if (lastPaintedIndices) {
                    for (let k = 0; k < lastPaintedIndices.length; k++) {
                        const p = lastPaintedIndices[k] * 4;
                        odata[p] = 0; odata[p + 1] = 0; odata[p + 2] = 0; odata[p + 3] = 0;
                    }
                }
                if (newIndices) {
                    for (let k = 0; k < newIndices.length; k++) {
                        const p = newIndices[k] * 4;
                        odata[p] = 255; 
						odata[p + 1] = 255; 
						odata[p + 2] = 255; 
						odata[p + 3] = 30;
                    }
                }

                overlayCtx.putImageData(
                    overlayImageData,
                    0, 0,
                    dirty.x, dirty.y, dirty.w, dirty.h
                );

                lastPaintedIndices = newIndices;
            }

            if (loadedMapData && loadedMapData.mapUrl) {
                URL.revokeObjectURL(loadedMapData.mapUrl);
            }

            mapDisplay.innerHTML = '';

            const img = document.createElement('img');
            img.src = mapUrl;
            img.alt = 'Загруженная карта';
            img.id = 'loaded-map-image';
            img.draggable = false;
            mapDisplay.appendChild(img);
            mapDisplay.appendChild(overlayCanvas);

            loadedMapData = {
                mapBlob,
                mapUrl,
                W,
                H,
                voronojCanvas,
                voronojData32,
                provinceIndices,
                overlayCanvas,
                overlayCtx,
                info,
                selectedIndex: -1,
                setSelection
            };

            fitToScreen();
            updateCursor();
            mapStatus.textContent = `Карта загружена: ${mapEntryName}`;
        } catch (err) {
            console.error(err);
            mapStatus.textContent = 'Ошибка загрузки: ' + err.message;
        } finally {
            mapFileInput.value = '';
        }
    });

    // ===== Панорамирование и клики =====

    viewport.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (!loadedMapData) return;

        view.pendingDown = { x: e.clientX, y: e.clientY, time: Date.now() };
        view.isPanning = false;
        view.panStartX = e.clientX;
        view.panStartY = e.clientY;
        view.panLastX = view.translateX;
        view.panLastY = view.translateY;
        viewport.setPointerCapture(e.pointerId);
    });

    viewport.addEventListener('pointermove', (e) => {
        if (!view.pendingDown && !view.isPanning) return;
        if (e.buttons === 0) return;

        const dx = e.clientX - view.panStartX;
        const dy = e.clientY - view.panStartY;

        if (!view.isPanning) {
            if (Math.hypot(dx, dy) > 3) {
                view.isPanning = true;
                updateCursor();
            } else {
                return;
            }
        }

        view.translateX = view.panLastX + dx;
        view.translateY = view.panLastY + dy;
        applyTransform();
    });

    viewport.addEventListener('pointerup', (e) => {
        if (e.button !== 0) return;
        if (viewport.hasPointerCapture(e.pointerId)) {
            viewport.releasePointerCapture(e.pointerId);
        }

        const wasPanning = view.isPanning;
        view.isPanning = false;
        view.pendingDown = null;

        if (wasPanning) {
            updateCursor();
            return;
        }

        if (!view.selectionMode) return;
        if (!loadedMapData) return;

        // Координаты в системе исходного изображения
        const rect = mapDisplay.getBoundingClientRect();
        const x = Math.floor((e.clientX - rect.left) / view.scale);
        const y = Math.floor((e.clientY - rect.top) / view.scale);

        const { W, H, voronojData32, provinceIndices, info, setSelection } = loadedMapData;
        if (x < 0 || y < 0 || x >= W || y >= H) return;

        const colorAtClick = voronojData32[y * W + x];
        const index = info.colors.indexOf(colorAtClick);
        if (index === -1) {
            mapStatus.textContent =
                `Цвет 0x${colorAtClick.toString(16).padStart(6, '0')} не найден. Координаты: ${x},${y}`;
            return;
        }

        if (loadedMapData.selectedIndex === index) {
            setSelection(null);
            loadedMapData.selectedIndex = -1;
            mapStatus.textContent = `Выделение снято (ID: ${index})`;
            return;
        }

        const indices = provinceIndices.get(colorAtClick);
        if (!indices) return;

        setSelection(indices);
        loadedMapData.selectedIndex = index;
        mapStatus.textContent = `Провинция ID: ${index}`;
    });

    viewport.addEventListener('pointercancel', (e) => {
        view.isPanning = false;
        view.pendingDown = null;
        if (viewport.hasPointerCapture(e.pointerId)) {
            viewport.releasePointerCapture(e.pointerId);
        }
        updateCursor();
    });

    viewport.addEventListener('wheel', (e) => {
        if (!loadedMapData) return;
        e.preventDefault();
        const rect = viewport.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        zoomAt(cx, cy, factor);
    }, { passive: false });

    viewport.addEventListener('dblclick', (e) => {
        if (!loadedMapData) return;
        e.preventDefault();
        fitToScreen();
    });

    updateCursor();

    window.addEventListener('keydown', (e) => {
        if (!loadedMapData) return;

        const STEP = 50;
        const ZOOM_STEP = 1.1;
        const cx = viewport.clientWidth / 2;
        const cy = viewport.clientHeight / 2;

        switch (e.code) {
            case 'Equal': // +
                e.preventDefault();
                zoomAt(cx, cy, ZOOM_STEP);
                break;
            case 'Minus': // -
                e.preventDefault();
                zoomAt(cx, cy, 1 / ZOOM_STEP);
                break;
            case 'Digit0': // 0
                e.preventDefault();
                fitToScreen();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                view.translateX += STEP;
                applyTransform();
                break;
            case 'ArrowRight':
                e.preventDefault();
                view.translateX -= STEP;
                applyTransform();
                break;
            case 'ArrowUp':
                e.preventDefault();
                view.translateY += STEP;
                applyTransform();
                break;
            case 'ArrowDown':
                e.preventDefault();
                view.translateY -= STEP;
                applyTransform();
                break;
        }
    });
});