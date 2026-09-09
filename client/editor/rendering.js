import { state } from './state.js';
import { hexToRgba, getVisualRadiusImage, intToRgb } from './utils.js';

export function redrawPoints(overlay) {
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (state.points.length >= 2) {
        try {
            const delaunay = d3.Delaunay.from(state.points.map(p => [p.x, p.y]));
            const voronoi = delaunay.voronoi([0, 0, overlay.width, overlay.height]);

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

    if (!state.points.length) return;
    const visualRadius = getVisualRadiusImage(state.scale);
    for (let i = 0; i < state.points.length; i++) {
        const p = state.points[i];
        ctx.beginPath();
        let radius = visualRadius;
        let fillStyle = 'rgba(255, 50, 50, 0.8)';

        if (i === state.hoveredPointIndex && i !== state.draggedPointIndex && i !== state.followPointIndex) {
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

    if (points.length >= 2) {
        if (!state.cellsCanvas || state.cellsCanvas.width !== overlay.width || state.cellsCanvas.height !== overlay.height) {
            state.cellsCanvas = updateCellsCanvas(overlay, points, colors);
        }
        ctx.globalAlpha = fillAlpha;
        ctx.drawImage(state.cellsCanvas, 0, 0);
        ctx.globalAlpha = 1.0;
    }

    if (state.brushCanvas) {
        // Применяем мазки
        ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(state.brushCanvas, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = fillAlpha;
        ctx.drawImage(state.brushCanvas, 0, 0);
        ctx.globalAlpha = 1.0;
    }
}