import { state } from './state.js';
import { hexToRgba, getVisualRadiusImage, intToRgb, computeVoronoiNeighbours } from './utils.js';

// ============================================================
//  Кэш слоя Вороного
// ============================================================
//  Диаграмма Вороного зависит ТОЛЬКО от координат точек и стилей
//  (заливка/границы), но НЕ от масштаба и панорамирования.
//  Поэтому её можно смело кэшировать и пересчитывать лишь когда
//  изменились точки или стили.
// ============================================================
let voronoiCache = null;
let voronoiCacheKey = '';

function computeCacheKey() {
    let h = state.points.length | 0;
    for (let i = 0; i < state.points.length; i++) {
        const p = state.points[i];
        h = (h * 31 + Math.round(p.x * 1000)) | 0;
        h = (h * 31 + Math.round(p.y * 1000)) | 0;
    }
    return `${h}|${state.fillColor}|${state.fillAlpha}|${state.strokeColor}|${state.strokeAlpha}|${state.points.length}`;
}

function buildVoronoiCache(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    if (state.points.length >= 2) {
        try {
            const delaunay = d3.Delaunay.from(state.points.map(p => [p.x, p.y]));
            const voronoi = delaunay.voronoi([0, 0, width, height]);

            ctx.fillStyle = hexToRgba(state.fillColor, state.fillAlpha);
            ctx.strokeStyle = hexToRgba(state.strokeColor, state.strokeAlpha);
            ctx.lineWidth = 1;

            for (let i = 0; i < state.points.length; i++) {
                ctx.beginPath();
                voronoi.renderCell(i, ctx);
                ctx.fill();
                ctx.stroke();
            }
        } catch (e) {
            console.warn('Voronoi diagram error:', e);
        }
    }
    return canvas;
}

/** Явный сброс кэша (на случай, если хеша недостаточно) */
export function invalidateVoronoiCache() {
    voronoiCache = null;
    voronoiCacheKey = '';
}

// ============================================================
//  Планировщик перерисовки: не чаще одного раза за кадр
// ============================================================
let redrawScheduled = false;
let pendingOverlay = null;

export function redrawPoints(overlay) {
    pendingOverlay = overlay;
    if (redrawScheduled) return;
    redrawScheduled = true;

    requestAnimationFrame(() => {
        redrawScheduled = false;
        const ov = pendingOverlay;
        pendingOverlay = null;
        if (ov && ov.width && ov.height) {
            renderPointsNow(ov);
        }
    });
}


function drawNeighbourLines(ctx) {
    const sel = state.selectedTileIndex;
    if (sel < 0 || sel >= state.points.length) return;
    const overlayW = ctx.canvas.width;
    const overlayH = ctx.canvas.height;
    const neighbours = state.customNeighbours
        || computeVoronoiNeighbours(state.points, overlayW, overlayH);
    const nbrs = neighbours[sel] ?? [];
    const from = state.points[sel];

    const lw = Math.max(1.5, 2 / state.scale);
    ctx.strokeStyle = 'rgba(0, 200, 200, 0.85)';
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';

    for (const n of nbrs) {
        if (n < 0 || n >= state.points.length) continue;
        const to = state.points[n];
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
    }
}

function drawEconomyNumbers(ctx) {
    if (state.points.length === 0) return;
    const fontSize = 14 / state.scale;
    const offsetY = 12 / state.scale;
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, fontSize / 7);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < state.points.length; i++) {
        const v = state.economies ? state.economies[i] : 1000;
        if (v == null) continue;
        const p = state.points[i];
        ctx.strokeText(String(v), p.x, p.y + offsetY);
        ctx.fillText(String(v), p.x, p.y + offsetY);
    }
}



function renderPointsNow(overlay) {
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    // ---- 1. Базовый слой ----
    // Если редактор уже использовался (editorColors задан и длина совпадает
    // с количеством точек) — показываем «как в редакторе»: цветные ячейки
    // + мазки кистью. Иначе — нейтральный Voronoi с настраиваемой заливкой.
    const hasEditor = state.editorColors !== null
        && state.editorColors.length === state.points.length
        && state.points.length >= 2;

    if (hasEditor) {
        if (!state.cellsCanvas
            || state.cellsCanvas.width  !== overlay.width
            || state.cellsCanvas.height !== overlay.height) {
            state.cellsCanvas = updateCellsCanvas(overlay, state.points, state.editorColors);
        }
        ctx.globalAlpha = state.fillAlpha;
        if (state.cellsCanvas) {
            ctx.drawImage(state.cellsCanvas, 0, 0);
        }
        if (state.brushCanvas) {
            ctx.drawImage(state.brushCanvas, 0, 0);
        }
        ctx.globalAlpha = 1.0;
    } else if (state.points.length >= 2) {
        const key = computeCacheKey();
        const needRebuild =
            !voronoiCache ||
            voronoiCache.width !== overlay.width ||
            voronoiCache.height !== overlay.height ||
            voronoiCacheKey !== key;

        if (needRebuild) {
            voronoiCache = buildVoronoiCache(overlay.width, overlay.height);
            voronoiCacheKey = key;
        }
        ctx.drawImage(voronoiCache, 0, 0);
    }

    // ---- 2. Линии соседей ----
    if (state.mode === 'neighbours') {
        drawNeighbourLines(ctx);
    }

    // ---- 3. Слой маркеров точек ----
    if (!state.points.length) return;
    const visualRadius = getVisualRadiusImage(state.scale);

    for (let i = 0; i < state.points.length; i++) {
        const p = state.points[i];
        ctx.beginPath();
        let radius = visualRadius;
        let fillStyle = 'rgba(255, 50, 50, 0.8)';

        if (state.mode === 'neighbours' && i === state.selectedTileIndex) {
            radius = visualRadius * 2.0;
            fillStyle = 'rgba(0, 200, 200, 0.95)';
        } else if (i === state.hoveredPointIndex &&
                   i !== state.draggedPointIndex &&
                   i !== state.followPointIndex) {
            radius = visualRadius * 1.8;
            fillStyle = 'rgba(255, 200, 0, 0.95)';
        } else if (i === state.draggedPointIndex || i === state.followPointIndex) {
            radius = visualRadius * 1.6;
            fillStyle = 'rgba(255, 100, 0, 0.95)';
        }

        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = fillStyle;
        ctx.fill();
    }

    // ---- 4. Экономики ----
    if (state.mode === 'economy') {
        drawEconomyNumbers(ctx);
    }
}

export function applyTransform(preview, overlay) {
    const transform = `translate(${state.translateX}px, ${state.translateY}px) scale(${state.scale})`;
    preview.style.transform = transform;
    overlay.style.transform = transform;
}

export function fitToScreen(viewport, preview, overlay) {
    if (!preview.naturalWidth || !preview.naturalHeight) return;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    state.scale = Math.min(vw / preview.naturalWidth, vh / preview.naturalHeight, 1);
    state.translateX = (vw - preview.naturalWidth * state.scale) / 2;
    state.translateY = (vh - preview.naturalHeight * state.scale) / 2;
    applyTransform(preview, overlay);
    if (state.mode !== 'editor') {
        redrawPoints(overlay);
    }
}

export function zoomAt(cx, cy, factor, viewport, preview, overlay) {
    const newScale = Math.min(Math.max(state.scale * factor, 0.1), 10);
    const ratio = newScale / state.scale;
    state.translateX = cx - (cx - state.translateX) * ratio;
    state.translateY = cy - (cy - state.translateY) * ratio;
    state.scale = newScale;
    applyTransform(preview, overlay);
    if (state.mode !== 'editor') {
        redrawPoints(overlay);
    }
}

export function updateCellsCanvas(overlay, points, colors) {
    if (!points || points.length < 2) return null;
    const cellsCanvas = document.createElement('canvas');
    cellsCanvas.width = overlay.width;
    cellsCanvas.height = overlay.height;
    const ctx = cellsCanvas.getContext('2d');
    const delaunay = d3.Delaunay.from(points.map(p => [p.x, p.y]));
    const voronoi = delaunay.voronoi([0, 0, overlay.width, overlay.height]);
    for (let i = 0; i < points.length; i++) {
        const [r, g, b] = intToRgb(colors[i]);
        ctx.beginPath();
        voronoi.renderCell(i, ctx);
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fill();
    }
    return cellsCanvas;
}

export function renderEditor(overlay, points, colors, fillAlpha, strokeColor, strokeAlpha) {
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    // Кэш ячеек (без изменений)
    if (points.length >= 2) {
        if (!state.cellsCanvas ||
            state.cellsCanvas.width  !== overlay.width ||
            state.cellsCanvas.height !== overlay.height) {
            state.cellsCanvas = updateCellsCanvas(overlay, points, colors);
        }
    }

    // Единый непрозрачный слой: ячейки + мазки
    let combined = state.combinedCanvas;
    if (!combined ||
        combined.width  !== overlay.width ||
        combined.height !== overlay.height) {
        combined = state.combinedCanvas = document.createElement('canvas');
        combined.width  = overlay.width;
        combined.height = overlay.height;
    }
    const cctx = combined.getContext('2d');
    cctx.globalAlpha = 1;
    cctx.globalCompositeOperation = 'source-over';
    cctx.clearRect(0, 0, combined.width, combined.height);

    if (state.cellsCanvas) {
        cctx.drawImage(state.cellsCanvas, 0, 0);
    }
    if (state.brushCanvas) {
        // Один проход: мазок просто перекрывает ячейки.
        // Антиалиасинг границы учитывается только здесь.
        cctx.drawImage(state.brushCanvas, 0, 0);
		if (state.liveStrokeCanvas) {
			cctx.drawImage(state.liveStrokeCanvas, 0, 0);
		}
    }

    // Накладываем объединённый слой на overlay с нужной прозрачностью.
    ctx.globalAlpha = fillAlpha;
    ctx.drawImage(combined, 0, 0);
    ctx.globalAlpha = 1.0;
}