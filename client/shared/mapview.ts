// client/shared/mapview.ts
//
// MapView — переиспользуемый компонент для отображения .spielmap-архива
// с панорамированием, зумом и выделением тайлов.
//
// Использование:
//   const mv = new MapView(document.getElementById('viewport')!);
//   mv.onStatus(text => { ... });
//   mv.onTileClick(tileId => { ... });
//   await mv.loadFromBlob(blob);      // -> { W, H, info }
//   mv.setSelectionMode('tile');      // или 'none'
//   mv.selectTile(tileId);
//   mv.clearSelection();

import JSZip from 'jszip';

export interface Bounds {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface MapInfo {
    colors: number[];
    [key: string]: unknown;
}

export interface LoadedMapData {
    mapBlob: Blob;
    mapUrl: string;
    W: number;
    H: number;
    voronojCanvas: HTMLCanvasElement;
    voronojData32: Uint32Array;
    provinceIndices: Map<number, Uint32Array>;
    overlayCanvas: HTMLCanvasElement;
    overlayCtx: CanvasRenderingContext2D;
    countryOverlayCanvas: HTMLCanvasElement;   // ← НОВОЕ
    countryOverlayCtx: CanvasRenderingContext2D; // ← НОВОЕ
    info: MapInfo;
    selectedIndex: number;
    setSelection: (indices: Uint32Array | null) => void;
}

export type SelectionMode = 'none' | 'tile';
export type TileClickHandler = (tileId: number | null) => void;
export type StatusHandler = (text: string) => void;

export function boundsOf(indices: Uint32Array, W: number): Bounds {
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

export function unionBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
    if (!a) return b;
    if (!b) return a;
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const x2 = Math.max(a.x + a.w, b.x + b.w);
    const y2 = Math.max(a.y + a.h, b.y + b.h);
    return { x, y, w: x2 - x, h: y2 - y };
}

interface ViewState {
    scale: number;
    translateX: number;
    translateY: number;
    isPanning: boolean;
    panStartX: number;
    panStartY: number;
    panLastX: number;
    panLastY: number;
    pendingDown: { x: number; y: number; time: number } | null;
    selectionMode: boolean;
}

export class MapView {
    public readonly viewport: HTMLElement;
    public readonly mapDisplay: HTMLDivElement;
    public loadedMapData: LoadedMapData | null = null;

    private readonly view: ViewState = {
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

    private _tileClickCb: TileClickHandler | null = null;
    private _statusCb: StatusHandler | null = null;

    // связанные обработчики (для add/removeEventListener)
    private readonly _onPointerDown: (e: PointerEvent) => void;
    private readonly _onPointerMove: (e: PointerEvent) => void;
    private readonly _onPointerUp: (e: PointerEvent) => void;
    private readonly _onPointerCancel: (e: PointerEvent) => void;
    private readonly _onWheel: (e: WheelEvent) => void;
    private readonly _onDblClick: (e: MouseEvent) => void;
    private readonly _onKeyDown: (e: KeyboardEvent) => void;

    constructor(viewport: HTMLElement) {
        if (!viewport) throw new Error('MapView: viewport is required');
        this.viewport = viewport;

        let mapDisplay = viewport.querySelector<HTMLDivElement>('#map-display');
        if (!mapDisplay) {
            mapDisplay = document.createElement('div');
            mapDisplay.id = 'map-display';
            viewport.appendChild(mapDisplay);
        }
        this.mapDisplay = mapDisplay;

        this._onPointerDown   = this.handlePointerDown.bind(this);
        this._onPointerMove   = this.handlePointerMove.bind(this);
        this._onPointerUp     = this.handlePointerUp.bind(this);
        this._onPointerCancel = this.handlePointerCancel.bind(this);
        this._onWheel         = this.handleWheel.bind(this);
        this._onDblClick      = this.handleDblClick.bind(this);
        this._onKeyDown       = this.handleKeyDown.bind(this);

        viewport.addEventListener('pointerdown',   this._onPointerDown);
        viewport.addEventListener('pointermove',   this._onPointerMove);
        viewport.addEventListener('pointerup',     this._onPointerUp);
        viewport.addEventListener('pointercancel', this._onPointerCancel);
        viewport.addEventListener('wheel',         this._onWheel, { passive: false });
        viewport.addEventListener('dblclick',      this._onDblClick);
        window.addEventListener('keydown',         this._onKeyDown);

        this.updateCursor();
    }

    // ==================== Публичный API ====================

    async loadFromBlob(blob: Blob): Promise<{ W: number; H: number; info: MapInfo }> {
        this._status('Обработка карты...');
        try {
            const zip = await JSZip.loadAsync(blob);

            const mapEntryName = Object.keys(zip.files).find(name => name.startsWith('map.'));
            if (!mapEntryName) throw new Error('В архиве не найден файл карты (map.*)');

            const mapEntry = zip.file(mapEntryName);
            if (!mapEntry) throw new Error('Не удалось прочитать файл карты из архива');
            const mapBlob = await mapEntry.async('blob');
            const mapUrl = URL.createObjectURL(mapBlob);

            const voronojEntry = zip.file('voronoj.png');
            if (!voronojEntry) throw new Error('В архиве не найден файл voronoj.png');
            const voronojBlob = await voronojEntry.async('blob');
            const voronojUrl = URL.createObjectURL(voronojBlob);

            const infoEntry = zip.file('info.json');
            if (!infoEntry) throw new Error('В архиве не найден файл info.json');
            const infoText = await infoEntry.async('text');
            const info = JSON.parse(infoText) as MapInfo;

            const voronojImg = new Image();
            voronojImg.src = voronojUrl;
            await new Promise<void>((resolve, reject) => {
                voronojImg.onload = () => resolve();
                voronojImg.onerror = () => reject(new Error('Не удалось загрузить voronoj.png'));
            });
            URL.revokeObjectURL(voronojUrl);

            const voronojCanvas = document.createElement('canvas');
            const W = voronojCanvas.width = voronojImg.naturalWidth;
            const H = voronojCanvas.height = voronojImg.naturalHeight;
            const vctx = voronojCanvas.getContext('2d', { willReadFrequently: true });
            if (!vctx) throw new Error('Не удалось получить 2D-контекст для voronoj');
            vctx.drawImage(voronojImg, 0, 0);

            const imageData = vctx.getImageData(0, 0, W, H);
            const data = imageData.data;
            const voronojData32 = new Uint32Array(W * H);
            for (let i = 0, j = 0; i < data.length; i += 4, j++) {
                voronojData32[j] = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
            }

            const provinceIndices = new Map<number, Uint32Array>();
            {
                const tmp = new Map<number, number[]>();
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
            if (!overlayCtx) throw new Error('Не удалось получить 2D-контекст для overlay');

            const overlayImageData = overlayCtx.createImageData(W, H);
            const odata = overlayImageData.data;
            let lastPaintedIndices: Uint32Array | null = null;

            const setSelection = (newIndices: Uint32Array | null): void => {
                const oldB = lastPaintedIndices ? boundsOf(lastPaintedIndices, W) : null;
                const newB = newIndices ? boundsOf(newIndices, W) : null;
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
            };

            if (this.loadedMapData && this.loadedMapData.mapUrl) {
                URL.revokeObjectURL(this.loadedMapData.mapUrl);
            }

            // Оверлей стран — ниже оверлея выделения, чтобы белая
            // подсветка «курсора» рисовалась поверх.
            const countryOverlayCanvas = document.createElement('canvas');
            countryOverlayCanvas.id = 'map-country-overlay';
            countryOverlayCanvas.width = W;
            countryOverlayCanvas.height = H;
            countryOverlayCanvas.style.position = 'absolute';
            countryOverlayCanvas.style.top = '0';
            countryOverlayCanvas.style.left = '0';
            countryOverlayCanvas.style.pointerEvents = 'none';
            const countryOverlayCtx = countryOverlayCanvas.getContext('2d');
            if (!countryOverlayCtx) throw new Error('Не удалось получить 2D-контекст для country overlay');

            this.mapDisplay.innerHTML = '';

            const img = document.createElement('img');
            img.src = mapUrl;
            img.alt = 'Загруженная карта';
            img.id = 'loaded-map-image';
            img.draggable = false;
            this.mapDisplay.appendChild(img);
            this.mapDisplay.appendChild(countryOverlayCanvas);
            this.mapDisplay.appendChild(overlayCanvas);

            this.loadedMapData = {
                mapBlob,
                mapUrl,
                W,
                H,
                voronojCanvas,
                voronojData32,
                provinceIndices,
                overlayCanvas,
                overlayCtx,
                countryOverlayCanvas,
                countryOverlayCtx,
                info,
                selectedIndex: -1,
                setSelection
            };

            this.fitToScreen();
            this.updateCursor();
            this._status(`Карта загружена: ${mapEntryName}`);

            return { W, H, info };
        } catch (err) {
            console.error(err);
            const msg = err instanceof Error ? err.message : String(err);
            this._status('Ошибка обработки карты: ' + msg);
            throw err;
        }
    }

    onTileClick(cb: TileClickHandler): void { this._tileClickCb = cb; }
    onStatus(cb: StatusHandler): void { this._statusCb = cb; }

    setSelectionMode(mode: SelectionMode): void {
        this.view.selectionMode = (mode === 'tile');
        this.updateCursor();
    }

    get selectionMode(): boolean { return this.view.selectionMode; }

    selectTile(tileId: number | null): void {
        if (!this.loadedMapData) return;
        const { info, provinceIndices, setSelection } = this.loadedMapData;

        if (tileId == null) {
            setSelection(null);
            this.loadedMapData.selectedIndex = -1;
            return;
        }
        if (tileId < 0 || tileId >= info.colors.length) return;

        const color = info.colors[tileId];
        const indices = provinceIndices.get(color);
        if (!indices) return;

        setSelection(indices);
        this.loadedMapData.selectedIndex = tileId;
    }

    clearSelection(): void {
        if (!this.loadedMapData) return;
        this.loadedMapData.setSelection(null);
        this.loadedMapData.selectedIndex = -1;
    }
	
	    /**
     * Отрисовать страны поверх карты. Каждая страна — одна провинция,
     * закрашенная «истинным» цветом провинции с фиксированной alpha.
     * tileId === индекс в info.colors. Порядок: ниже оверлея выделения.
     */
    setCountries(list: Array<{ tileId: number }>): void {
        if (!this.loadedMapData) return;
        const { W, H, provinceIndices, info, countryOverlayCtx } = this.loadedMapData;

        countryOverlayCtx.clearRect(0, 0, W, H);

        if (list.length === 0) return;

        const imgData = countryOverlayCtx.createImageData(W, H);
        const d = imgData.data;

        for (const { tileId } of list) {
            if (!Number.isInteger(tileId) || tileId < 0 || tileId >= info.colors.length) continue;
            const rgb = info.colors[tileId];
            const indices = provinceIndices.get(rgb);
            if (!indices) continue;

            const r = (rgb >> 16) & 0xff;
            const g = (rgb >> 8) & 0xff;
            const b = rgb & 0xff;
            for (let k = 0; k < indices.length; k++) {
                const p = indices[k] * 4;
                d[p] = r;
                d[p + 1] = g;
                d[p + 2] = b;
                d[p + 3] = MapView.COUNTRY_ALPHA;
            }
        }

        countryOverlayCtx.putImageData(imgData, 0, 0);
    }

    /** Alpha (0..255) для заливки стран. Единственное место для настройки. */
    static readonly COUNTRY_ALPHA = 100;

    destroy(): void {
        this.viewport.removeEventListener('pointerdown',   this._onPointerDown);
        this.viewport.removeEventListener('pointermove',   this._onPointerMove);
        this.viewport.removeEventListener('pointerup',     this._onPointerUp);
        this.viewport.removeEventListener('pointercancel', this._onPointerCancel);
        this.viewport.removeEventListener('wheel',         this._onWheel);
        this.viewport.removeEventListener('dblclick',      this._onDblClick);
        window.removeEventListener('keydown',              this._onKeyDown);

        if (this.loadedMapData && this.loadedMapData.mapUrl) {
            URL.revokeObjectURL(this.loadedMapData.mapUrl);
        }
        this.loadedMapData = null;
    }

    // ==================== Вид (pan/zoom) ====================

    applyTransform(): void {
        this.mapDisplay.style.transform =
            `translate(${this.view.translateX}px, ${this.view.translateY}px) scale(${this.view.scale})`;
    }

    fitToScreen(): void {
        if (!this.loadedMapData) return;
        const { W, H } = this.loadedMapData;
        const vw = this.viewport.clientWidth;
        const vh = this.viewport.clientHeight;
        this.view.scale = Math.min(vw / W, vh / H, 1);
        this.view.translateX = (vw - W * this.view.scale) / 2;
        this.view.translateY = (vh - H * this.view.scale) / 2;
        this.applyTransform();
    }

    zoomAt(cx: number, cy: number, factor: number): void {
        const newScale = Math.min(Math.max(this.view.scale * factor, 0.05), 20);
        const ratio = newScale / this.view.scale;
        this.view.translateX = cx - (cx - this.view.translateX) * ratio;
        this.view.translateY = cy - (cy - this.view.translateY) * ratio;
        this.view.scale = newScale;
        this.applyTransform();
    }

    updateCursor(): void {
        if (this.view.isPanning) {
            this.viewport.style.cursor = 'grabbing';
        } else if (this.view.selectionMode) {
            this.viewport.style.cursor = 'crosshair';
        } else {
            this.viewport.style.cursor = 'grab';
        }
    }

    // ==================== Внутренние обработчики ====================

    private _status(text: string): void {
        if (this._statusCb) this._statusCb(text);
    }

    private _emitTileClick(tileId: number | null): void {
        if (this._tileClickCb) this._tileClickCb(tileId);
    }

    private handlePointerDown(e: PointerEvent): void {
        if (e.button !== 0) return;
        if (!this.loadedMapData) return;

        this.view.pendingDown = { x: e.clientX, y: e.clientY, time: Date.now() };
        this.view.isPanning = false;
        this.view.panStartX = e.clientX;
        this.view.panStartY = e.clientY;
        this.view.panLastX = this.view.translateX;
        this.view.panLastY = this.view.translateY;
        this.viewport.setPointerCapture(e.pointerId);
    }

    private handlePointerMove(e: PointerEvent): void {
        const v = this.view;
        if (!v.pendingDown && !v.isPanning) return;
        if (e.buttons === 0) return;

        const dx = e.clientX - v.panStartX;
        const dy = e.clientY - v.panStartY;

        if (!v.isPanning) {
            if (Math.hypot(dx, dy) > 3) {
                v.isPanning = true;
                this.updateCursor();
            } else {
                return;
            }
        }

        v.translateX = v.panLastX + dx;
        v.translateY = v.panLastY + dy;
        this.applyTransform();
    }

    private handlePointerUp(e: PointerEvent): void {
        if (e.button !== 0) return;
        if (this.viewport.hasPointerCapture(e.pointerId)) {
            this.viewport.releasePointerCapture(e.pointerId);
        }

        const wasPanning = this.view.isPanning;
        this.view.isPanning = false;
        this.view.pendingDown = null;

        if (wasPanning) {
            this.updateCursor();
            return;
        }

        if (!this.view.selectionMode) return;
        if (!this.loadedMapData) return;

        const rect = this.mapDisplay.getBoundingClientRect();
        const x = Math.floor((e.clientX - rect.left) / this.view.scale);
        const y = Math.floor((e.clientY - rect.top)  / this.view.scale);

        const { W, H, voronojData32, provinceIndices, info, setSelection } = this.loadedMapData;
        if (x < 0 || y < 0 || x >= W || y >= H) return;

        const colorAtClick = voronojData32[y * W + x];
        const index = info.colors.indexOf(colorAtClick);
        if (index === -1) {
            this._status(
                `Цвет 0x${colorAtClick.toString(16).padStart(6, '0')} не найден. Координаты: ${x},${y}`
            );
            return;
        }

        if (this.loadedMapData.selectedIndex === index) {
            setSelection(null);
            this.loadedMapData.selectedIndex = -1;
            this._status(`Выделение снято (ID: ${index})`);
            this._emitTileClick(null);
            return;
        }

        const indices = provinceIndices.get(colorAtClick);
        if (!indices) return;

        setSelection(indices);
        this.loadedMapData.selectedIndex = index;
        this._status(`Провинция ID: ${index}`);
        this._emitTileClick(index);
    }

    private handlePointerCancel(e: PointerEvent): void {
        this.view.isPanning = false;
        this.view.pendingDown = null;
        if (this.viewport.hasPointerCapture(e.pointerId)) {
            this.viewport.releasePointerCapture(e.pointerId);
        }
        this.updateCursor();
    }

    private handleWheel(e: WheelEvent): void {
        if (!this.loadedMapData) return;
        e.preventDefault();
        const rect = this.viewport.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        this.zoomAt(cx, cy, factor);
    }

    private handleDblClick(e: MouseEvent): void {
        if (!this.loadedMapData) return;
        e.preventDefault();
        this.fitToScreen();
    }

    private handleKeyDown(e: KeyboardEvent): void {
        if (!this.loadedMapData) return;

        const STEP = 50;
        const ZOOM_STEP = 1.1;
        const cx = this.viewport.clientWidth / 2;
        const cy = this.viewport.clientHeight / 2;

        switch (e.code) {
            case 'Equal':
                e.preventDefault();
                this.zoomAt(cx, cy, ZOOM_STEP);
                break;
            case 'Minus':
                e.preventDefault();
                this.zoomAt(cx, cy, 1 / ZOOM_STEP);
                break;
            case 'Digit0':
                e.preventDefault();
                this.fitToScreen();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                this.view.translateX += STEP;
                this.applyTransform();
                break;
            case 'ArrowRight':
                e.preventDefault();
                this.view.translateX -= STEP;
                this.applyTransform();
                break;
            case 'ArrowUp':
                e.preventDefault();
                this.view.translateY += STEP;
                this.applyTransform();
                break;
            case 'ArrowDown':
                e.preventDefault();
                this.view.translateY -= STEP;
                this.applyTransform();
                break;
        }
    }
}