// client/shared/mapview.ts
import JSZip from 'jszip';
import { createArrowOverlay } from '../game/arrow';

export interface Bounds {
    x: number; y: number; w: number; h: number;
}

export interface MapPoint { x: number; y: number; }

export interface MapInfo {
    colors: number[];
    points?: MapPoint[];
    neighbours?: number[][];
    tilecount?: number;
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
    tileCenters: Array<{ x: number; y: number }>;

    overlayCanvas: HTMLCanvasElement;
    overlayCtx: CanvasRenderingContext2D;
    countryOverlayCanvas: HTMLCanvasElement;
    countryOverlayCtx: CanvasRenderingContext2D;
    armyOverlayCanvas: HTMLCanvasElement;
    armyOverlayCtx: CanvasRenderingContext2D;
    labelOverlayCanvas: HTMLCanvasElement;
    labelOverlayCtx: CanvasRenderingContext2D;
    highlightOverlayCanvas: HTMLCanvasElement;
    highlightOverlayCtx: CanvasRenderingContext2D;
    arrowOverlay: SVGSVGElement;

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

function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
    if (!m) return null;
    const n = parseInt(m[1]!, 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
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
        scale: 1, translateX: 0, translateY: 0,
        isPanning: false,
        panStartX: 0, panStartY: 0, panLastX: 0, panLastY: 0,
        pendingDown: null,
        selectionMode: false,
    };

    /** Если true — клиент сам управляет подсветкой (setHighlight).
     *  MapView в этом режиме не применяет свою белую заливку. */
    private _externalSelection = false;

    private _tileClickCb: TileClickHandler | null = null;
    private _statusCb: StatusHandler | null = null;
    private _cancelStepCb: (() => void) | null = null;

    private readonly _onPointerDown: (e: PointerEvent) => void;
    private readonly _onPointerMove: (e: PointerEvent) => void;
    private readonly _onPointerUp: (e: PointerEvent) => void;
    private readonly _onPointerCancel: (e: PointerEvent) => void;
    private readonly _onWheel: (e: WheelEvent) => void;
    private readonly _onDblClick: (e: MouseEvent) => void;
    private readonly _onKeyDown: (e: KeyboardEvent) => void;
    private readonly _onContextMenu: (e: MouseEvent) => void;

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

        this._onPointerDown = this.handlePointerDown.bind(this);
        this._onPointerMove = this.handlePointerMove.bind(this);
        this._onPointerUp = this.handlePointerUp.bind(this);
        this._onPointerCancel = this.handlePointerCancel.bind(this);
        this._onWheel = this.handleWheel.bind(this);
        this._onDblClick = this.handleDblClick.bind(this);
        this._onKeyDown = this.handleKeyDown.bind(this);
        this._onContextMenu = this.handleContextMenu.bind(this);

        viewport.addEventListener('pointerdown', this._onPointerDown);
        viewport.addEventListener('pointermove', this._onPointerMove);
        viewport.addEventListener('pointerup', this._onPointerUp);
        viewport.addEventListener('pointercancel', this._onPointerCancel);
        viewport.addEventListener('wheel', this._onWheel, { passive: false });
        viewport.addEventListener('dblclick', this._onDblClick);
        viewport.addEventListener('contextmenu', this._onContextMenu);
        window.addEventListener('keydown', this._onKeyDown);

        this.updateCursor();
    }

    // ==================== Публичный API ====================

    async loadFromBlob(blob: Blob): Promise<{ W: number; H: number; info: MapInfo }> {
        this._status('Обработка карты...');
        try {
            const zip = await JSZip.loadAsync(blob);
            const mapEntryName = Object.keys(zip.files).find(n => n.startsWith('map.'));
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
                for (const [c, arr] of tmp) provinceIndices.set(c, Uint32Array.from(arr));
            }

            const tileCenters: Array<{ x: number; y: number }> = [];
            for (let i = 0; i < info.colors.length; i++) {
                const rgb = info.colors[i]!;
                const indices = provinceIndices.get(rgb);
                if (!indices || indices.length === 0) { tileCenters.push({ x: -1, y: -1 }); continue; }
                const b = boundsOf(indices, W);
                tileCenters.push({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
            }

            const overlayCanvas = document.createElement('canvas');
            overlayCanvas.id = 'map-overlay';
            overlayCanvas.width = W; overlayCanvas.height = H;
            overlayCanvas.style.position = 'absolute';
            overlayCanvas.style.top = '0'; overlayCanvas.style.left = '0';
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
                        odata[p] = 255; odata[p + 1] = 255; odata[p + 2] = 255; odata[p + 3] = 30;
                    }
                }
                overlayCtx.putImageData(overlayImageData, 0, 0, dirty.x, dirty.y, dirty.w, dirty.h);
                lastPaintedIndices = newIndices;
            };

            if (this.loadedMapData && this.loadedMapData.mapUrl) {
                URL.revokeObjectURL(this.loadedMapData.mapUrl);
            }

            const countryOverlayCanvas = document.createElement('canvas');
            countryOverlayCanvas.id = 'map-country-overlay';
            countryOverlayCanvas.width = W; countryOverlayCanvas.height = H;
            countryOverlayCanvas.style.position = 'absolute';
            countryOverlayCanvas.style.top = '0'; countryOverlayCanvas.style.left = '0';
            countryOverlayCanvas.style.pointerEvents = 'none';
            const countryOverlayCtx = countryOverlayCanvas.getContext('2d');
            if (!countryOverlayCtx) throw new Error('Не удалось получить 2D-контекст для country overlay');

            const labelOverlayCanvas = document.createElement('canvas');
            labelOverlayCanvas.id = 'map-label-overlay';
            labelOverlayCanvas.width = W; labelOverlayCanvas.height = H;
            labelOverlayCanvas.style.position = 'absolute';
            labelOverlayCanvas.style.top = '0'; labelOverlayCanvas.style.left = '0';
            labelOverlayCanvas.style.pointerEvents = 'none';
            const labelOverlayCtx = labelOverlayCanvas.getContext('2d');
            if (!labelOverlayCtx) throw new Error('Не удалось получить 2D-контекст для label overlay');

            const armyOverlayCanvas = document.createElement('canvas');
            armyOverlayCanvas.id = 'map-army-overlay';
            armyOverlayCanvas.width = W; armyOverlayCanvas.height = H;
            armyOverlayCanvas.style.position = 'absolute';
            armyOverlayCanvas.style.top = '0'; armyOverlayCanvas.style.left = '0';
            armyOverlayCanvas.style.pointerEvents = 'none';
            const armyOverlayCtx = armyOverlayCanvas.getContext('2d');
            if (!armyOverlayCtx) throw new Error('Не удалось получить 2D-контекст для army overlay');

            const highlightOverlayCanvas = document.createElement('canvas');
            highlightOverlayCanvas.id = 'map-highlight-overlay';
            highlightOverlayCanvas.width = W; highlightOverlayCanvas.height = H;
            highlightOverlayCanvas.style.position = 'absolute';
            highlightOverlayCanvas.style.top = '0'; highlightOverlayCanvas.style.left = '0';
            highlightOverlayCanvas.style.pointerEvents = 'none';
            const highlightOverlayCtx = highlightOverlayCanvas.getContext('2d');
            if (!highlightOverlayCtx) throw new Error('Не удалось получить 2D-контекст для highlight overlay');

            this.mapDisplay.innerHTML = '';

            const img = document.createElement('img');
            img.src = mapUrl;
            img.alt = 'Загруженная карта';
            img.id = 'loaded-map-image';
            img.draggable = false;
            this.mapDisplay.appendChild(img);
            this.mapDisplay.appendChild(countryOverlayCanvas);
            this.mapDisplay.appendChild(labelOverlayCanvas);
            this.mapDisplay.appendChild(armyOverlayCanvas);
            this.mapDisplay.appendChild(overlayCanvas);
            this.mapDisplay.appendChild(highlightOverlayCanvas);

            const arrowOverlay = createArrowOverlay(this.mapDisplay, W, H);

            this.loadedMapData = {
                mapBlob, mapUrl, W, H,
                voronojCanvas, voronojData32, provinceIndices, tileCenters,
                overlayCanvas, overlayCtx,
                countryOverlayCanvas, countryOverlayCtx,
                armyOverlayCanvas, armyOverlayCtx,
                labelOverlayCanvas, labelOverlayCtx,
                highlightOverlayCanvas, highlightOverlayCtx,
                arrowOverlay,
                info,
                selectedIndex: -1,
                setSelection,
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
    onCancelStep(cb: () => void): void { this._cancelStepCb = cb; }

    setSelectionMode(mode: SelectionMode): void {
        this.view.selectionMode = (mode === 'tile');
        this.updateCursor();
    }

    get selectionMode(): boolean { return this.view.selectionMode; }

    setExternalSelectionMode(on: boolean): void {
        this._externalSelection = on;
    }

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
     * Подсветить набор тайлов несколькими цветными слоями. Слои рисуются
     * в порядке массива: если тайл встречается в нескольких слоях, побеждает
     * последний (перекрывает более ранние). Альфа — 60/255 для всех слоёв.
     */
    setHighlightLayers(layers: Array<{ tiles: number[]; color: string }>): void {
        const d = this.loadedMapData;
        if (!d) return;
        const { W, H, highlightOverlayCtx, provinceIndices, info } = d;
        highlightOverlayCtx.clearRect(0, 0, W, H);
        if (layers.length === 0) return;
        const img = highlightOverlayCtx.createImageData(W, H);
        const data = img.data;
        let painted = false;
        for (const layer of layers) {
            const rgb = parseHexColor(layer.color);
            if (!rgb) continue;
            for (const id of layer.tiles) {
                if (!Number.isInteger(id) || id < 0 || id >= info.colors.length) continue;
                const tileRgb = info.colors[id];
                const indices = provinceIndices.get(tileRgb);
                if (!indices) continue;
                painted = true;
                for (let k = 0; k < indices.length; k++) {
                    const p = indices[k]! * 4;
                    data[p] = rgb.r;
                    data[p + 1] = rgb.g;
                    data[p + 2] = rgb.b;
                    data[p + 3] = 60;
                }
            }
        }
        if (painted) highlightOverlayCtx.putImageData(img, 0, 0);
    }

    /** Удобная обёртка: один цветной слой. По умолчанию — белый. */
    setHighlight(tileIds: number[], color: string = '#ffffff'): void {
        this.setHighlightLayers([{ tiles: tileIds, color }]);
    }

    clearHighlight(): void {
        const d = this.loadedMapData;
        if (!d) return;
        d.highlightOverlayCtx.clearRect(0, 0, d.W, d.H);
    }

    /** Подписи провинций (имена из `lobby.renames`). */
    setTileLabels(labels: Map<number, string>): void {
        const d = this.loadedMapData;
        if (!d) return;
        const { W, H, labelOverlayCtx, info, tileCenters } = d;
        labelOverlayCtx.clearRect(0, 0, W, H);
        if (labels.size === 0) return;

        const fontSize = Math.max(14, Math.round(W / 40));
        const LABEL_OFFSET = Math.round(fontSize / 2);
        labelOverlayCtx.font = `bold ${fontSize}px sans-serif`;
        labelOverlayCtx.textAlign = 'center';
        labelOverlayCtx.textBaseline = 'bottom';
        labelOverlayCtx.lineWidth = Math.max(2, fontSize / 7);
        labelOverlayCtx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
        labelOverlayCtx.fillStyle = '#ffffff';

        const pts = info.points;
        for (const [tileId, name] of labels) {
            if (!name) continue;
            let x: number | null = null, y: number | null = null;
            if (pts && pts[tileId]) { x = pts[tileId]!.x; y = pts[tileId]!.y; }
            if (x == null || y == null) {
                const c = tileCenters[tileId];
                if (!c || c.x < 0) continue;
                x = c.x; y = c.y;
            }
            const labelY = y - LABEL_OFFSET;
            labelOverlayCtx.strokeText(name, x, labelY);
            labelOverlayCtx.fillText(name, x, labelY);
        }
    }

    /**
     * Отрисовать страны поверх карты. Каждый тайл закрашивается цветом:
     * - `color`, если задан;
     * - иначе `info.colors[tileId]` (текущее поведение).
     */
    setCountries(list: Array<{ tileId: number; color?: number }>): void {
        if (!this.loadedMapData) return;
        const { W, H, provinceIndices, info, countryOverlayCtx } = this.loadedMapData;
        countryOverlayCtx.clearRect(0, 0, W, H);
        if (list.length === 0) return;

        const imgData = countryOverlayCtx.createImageData(W, H);
        const d = imgData.data;

        for (const { tileId, color } of list) {
            if (!Number.isInteger(tileId) || tileId < 0 || tileId >= info.colors.length) continue;
            const rgb = color ?? info.colors[tileId];
            const indices = provinceIndices.get(info.colors[tileId]!);
            if (!indices) continue;
            const r = (rgb >> 16) & 0xff;
            const g = (rgb >> 8) & 0xff;
            const b = rgb & 0xff;
            for (let k = 0; k < indices.length; k++) {
                const p = indices[k] * 4;
                d[p] = r; d[p + 1] = g; d[p + 2] = b;
                d[p + 3] = MapView.COUNTRY_ALPHA;
            }
        }
        countryOverlayCtx.putImageData(imgData, 0, 0);
    }

        /**
     * Численность армий над провинциями — визуально как подписи стрелок:
     * «● inf / ▲ can» через текстовые глифы с тем же соотношением шрифтов,
     * что в arrow.ts (TRIANGLE_SCALE = 2.2, CIRCLE_SCALE = TRIANGLE_SCALE * 1.27
     * и circleNudge для вертикального выравнивания кружка).
     */
    setArmies(byTileId: Map<number, { inf: number; can: number; color?: string }>): void {
        const d = this.loadedMapData;
        if (!d) return;
        const { W, H, armyOverlayCtx: ctx, tileCenters, info } = d;
        ctx.clearRect(0, 0, W, H);
        if (byTileId.size === 0) return;

        const FONT_PX = 20;
        const TRIANGLE_SCALE = 2.2;
        const CIRCLE_SCALE = TRIANGLE_SCALE * 1.27;
        const circleFontSize = FONT_PX * CIRCLE_SCALE;
        const triangleFontSize = FONT_PX * TRIANGLE_SCALE;
        const circleNudge = -circleFontSize * 0.06;
        const ARMY_OFFSET = Math.round(FONT_PX / 2);

        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        const pts = info.points;
        for (const [tileId, { inf, can, color }] of byTileId) {
            if (inf === 0 && can === 0) continue;
            if (!Number.isInteger(tileId) || tileId < 0 || tileId >= info.colors.length) continue;

            let cx: number | null = null, baseY: number | null = null;
            if (pts && pts[tileId]) { cx = pts[tileId]!.x; baseY = pts[tileId]!.y; }
            if (cx == null || baseY == null) {
                const c = tileCenters[tileId];
                if (!c || c.x < 0) continue;
                cx = c.x; baseY = c.y;
            }
            const cy = baseY + ARMY_OFFSET;

            const fill = color ?? '#222';
            const infStr = String(inf);
            const canStr = String(can);
            const slashStr = ' / ';

            // Ширины каждой части считаем с её собственным font-size.
            ctx.font = `${circleFontSize}px sans-serif`;
            const wCircle = ctx.measureText('●').width;
            ctx.font = `${FONT_PX}px sans-serif`;
            const wInf = ctx.measureText(infStr).width;
            const wSlash = ctx.measureText(slashStr).width;
            const wCan = ctx.measureText(canStr).width;
            ctx.font = `${triangleFontSize}px sans-serif`;
            const wTriangle = ctx.measureText('▲').width;

            const totalW = wCircle + wInf + wSlash + wTriangle + wCan;
            let x = cx - totalW / 2;

            // ● — цвет страны, со сдвигом вверх (circleNudge)
            ctx.font = `${circleFontSize}px sans-serif`;
            ctx.fillStyle = fill;
            ctx.fillText('●', x, cy + circleNudge);
            x += wCircle;

            // inf — тёмно-серый, как в подписях стрелок
            ctx.font = `${FONT_PX}px sans-serif`;
            ctx.fillStyle = '#222';
            ctx.fillText(infStr, x, cy);
            x += wInf;

            // " / "
            ctx.fillText(slashStr, x, cy);
            x += wSlash;

            // ▲ — цвет страны
            ctx.font = `${triangleFontSize}px sans-serif`;
            ctx.fillStyle = fill;
            ctx.fillText('▲', x, cy);
            x += wTriangle;

            // can — тёмно-серый
            ctx.font = `${FONT_PX}px sans-serif`;
            ctx.fillStyle = '#222';
            ctx.fillText(canStr, x, cy);
        }
    }
	static readonly COUNTRY_ALPHA = 160;

    destroy(): void {
        this.viewport.removeEventListener('pointerdown', this._onPointerDown);
        this.viewport.removeEventListener('pointermove', this._onPointerMove);
        this.viewport.removeEventListener('pointerup', this._onPointerUp);
        this.viewport.removeEventListener('pointercancel', this._onPointerCancel);
        this.viewport.removeEventListener('wheel', this._onWheel);
        this.viewport.removeEventListener('dblclick', this._onDblClick);
        this.viewport.removeEventListener('contextmenu', this._onContextMenu);
        window.removeEventListener('keydown', this._onKeyDown);
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
            if (Math.hypot(dx, dy) > 3) { v.isPanning = true; this.updateCursor(); }
            else return;
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

        if (wasPanning) { this.updateCursor(); return; }
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

        // Внешнее выделение — MapView не трогает подсветку.
        if (this._externalSelection) {
            this._status(`Провинция ID: ${index}`);
            this._emitTileClick(index);
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

    private handleContextMenu(e: MouseEvent): void {
        if (!this.loadedMapData) return;
        e.preventDefault();
        if (this._cancelStepCb) this._cancelStepCb();
    }

    private handleKeyDown(e: KeyboardEvent): void {
        if (!this.loadedMapData) return;

        const t = e.target;
        if (
            t instanceof HTMLInputElement ||
            t instanceof HTMLTextAreaElement ||
            (t instanceof HTMLElement && t.isContentEditable)
        ) return;

        const STEP = 50;
        const ZOOM_STEP = 1.1;
        const cx = this.viewport.clientWidth / 2;
        const cy = this.viewport.clientHeight / 2;

        switch (e.code) {
            case 'Equal': e.preventDefault(); this.zoomAt(cx, cy, ZOOM_STEP); break;
            case 'Minus': e.preventDefault(); this.zoomAt(cx, cy, 1 / ZOOM_STEP); break;
            case 'Digit0': e.preventDefault(); this.fitToScreen(); break;
            case 'ArrowLeft': e.preventDefault(); this.view.translateX += STEP; this.applyTransform(); break;
            case 'ArrowRight': e.preventDefault(); this.view.translateX -= STEP; this.applyTransform(); break;
            case 'ArrowUp': e.preventDefault(); this.view.translateY += STEP; this.applyTransform(); break;
            case 'ArrowDown': e.preventDefault(); this.view.translateY -= STEP; this.applyTransform(); break;
        }
    }
}