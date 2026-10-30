import { state, setMode, addPoint, removePoint, DRAG_THRESHOLD } from './state.js';
import { updateButtons, switchMode, onEconomyTileClick, onNeighboursTileClick } from './main.js';
import {
    getBaseCursor, getImageCoords, getInteractionRadiusImage,
    hitTestPoint, hitTestTile, intToRgb,
} from './utils.js';
import { redrawPoints, applyTransform, fitToScreen, zoomAt, renderEditor } from './rendering.js';


// Вспомогательные функции для рисования кистью
function paintStrokeTo(ctx, pts, radius, color) {
    if (!pts.length) return;
    ctx.globalAlpha = 1.0;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = radius * 2;

    if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, radius, 0, Math.PI * 2);
        ctx.fill();
        return;
    }
    // ОДИН путь — ОДИН stroke → никаких AA-швов внутри мазка
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
}

function renderLiveStroke() {
    const c = state.liveStrokeCanvas;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    paintStrokeTo(ctx, state.liveStrokePoints, state.liveStrokeRadius, state.liveStrokeColor);
}

function commitLiveStroke() {
    if (!state.liveStrokeCanvas || !state.liveStrokePoints.length) return;
    
    const lctx = state.liveStrokeCanvas.getContext('2d');
    const width = state.liveStrokeCanvas.width;
    const height = state.liveStrokeCanvas.height;

    // 1. Берем пиксели ТОЛЬКО текущего мазка
    const imgData = lctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    const [r, g, b] = state.brushColor;

    // 2. Пороговая обработка: убиваем полупрозрачные края, ставим точный цвет
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] >= 128) {
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
            data[i + 3] = 255; // Делаем пиксель абсолютно плотным
        } else {
            data[i + 3] = 0;   // Всё, что полупрозрачное — стираем
        }
    }
    lctx.putImageData(imgData, 0, 0);

    // 3. Переносим уже "жесткий" мазок в накопительный слой
    const bctx = state.brushCanvas.getContext('2d');
    bctx.drawImage(state.liveStrokeCanvas, 0, 0);

    // 4. Чистим live-слой для следующего мазка
    lctx.clearRect(0, 0, width, height);
    state.liveStrokePoints = [];
}

function updateCursor(viewport) {
    if (state.mode === 'editor') {
        viewport.style.cursor = 'default';
        return;
    }

    if ((state.mode === 'delete' || state.mode === 'move') && state.hoveredPointIndex !== -1) {
        viewport.style.cursor = 'pointer';
    } else if (state.mode === 'move' && (state.draggedPointIndex !== -1 || state.followPointIndex !== -1)) {
        viewport.style.cursor = 'grabbing';
    } else {
        viewport.style.cursor = getBaseCursor(state.mode);
    }
}

function updateHover(e, viewport, overlay) {
    if (state.mode === 'editor') return;

    if (state.mode !== 'delete' && state.mode !== 'move') {
        if (state.hoveredPointIndex !== -1) {
            state.hoveredPointIndex = -1;
            redrawPoints(overlay);
        }
        updateCursor(viewport);
        return;
    }
    if (!overlay.width) return;
    const coords = getImageCoords(e, viewport, state.scale, state.translateX, state.translateY);
    const idx = hitTestPoint(state.points, coords.imageX, coords.imageY, getInteractionRadiusImage(state.scale));
    if (idx !== state.hoveredPointIndex) {
        state.hoveredPointIndex = idx;
        redrawPoints(overlay);
    }
    updateCursor(viewport);
}

export function initInteractions(viewport, preview, overlay) {
    viewport.addEventListener('pointerdown', (e) => {
        // Режим редактора
        if (state.mode === 'editor') {
            e.preventDefault();
            const coords = getImageCoords(e, viewport, state.scale, state.translateX, state.translateY);
            const imageX = coords.imageX;
            const imageY = coords.imageY;
            if (imageX < 0 || imageX >= overlay.width || imageY < 0 || imageY >= overlay.height) return;

            if (state.editorTool === 'eyedropper') {
                // Выбор цвета из ячейки
                if (state.points.length >= 2 && state.editorColors) {
                    const delaunay = d3.Delaunay.from(state.points.map(p => [p.x, p.y]));
                    const idx = delaunay.find(imageX, imageY);
                    if (idx >= 0 && idx < state.editorColors.length) {
                        state.brushColor = intToRgb(state.editorColors[idx]);
                        state.editorTool = 'brush';
                        if (state.editorToolChangeCallback) state.editorToolChangeCallback();
                        updateCursor(viewport);
                    }
                }
                return;
            }

			if (state.editorTool === 'brush') {
				if (!state.liveStrokeCanvas) {
					state.liveStrokeCanvas = document.createElement('canvas');
				}
				state.liveStrokeCanvas.width  = overlay.width;
				state.liveStrokeCanvas.height = overlay.height;

				state.liveStrokePoints = [{ x: imageX, y: imageY }];
				state.liveStrokeRadius = state.brushSize / state.scale;   // фиксируем ОДИН раз
				state.liveStrokeColor  = `rgb(${state.brushColor[0]}, ${state.brushColor[1]}, ${state.brushColor[2]})`;

				state.isDrawing = true;
				renderLiveStroke();
				renderEditor(overlay, state.points, state.editorColors,
							 state.fillAlpha, state.strokeColor, state.strokeAlpha);
				e.preventDefault();
				return;
			}
            return;
        }

        // Обычный режим
        if (!preview.naturalWidth) return;
        if (e.button !== 0) return;

        if (state.mode === 'pan') {
            state.isPanning = true;
            state.panStartX = e.clientX;
            state.panStartY = e.clientY;
            state.panLastX = state.translateX;
            state.panLastY = state.translateY;
            viewport.setPointerCapture(e.pointerId);
            viewport.style.cursor = 'grabbing';
            e.preventDefault();
            return;
        }

        if (state.mode === 'move') {
            const coords = getImageCoords(e, viewport, state.scale, state.translateX, state.translateY);
            const hitIndex = hitTestPoint(state.points, coords.imageX, coords.imageY, getInteractionRadiusImage(state.scale));
            if (state.followPointIndex !== -1) {
                const p = state.points[state.followPointIndex];
                p.x = coords.imageX;
                p.y = coords.imageY;
                state.followPointIndex = -1;
                redrawPoints(overlay);
                updateCursor(viewport);
                e.preventDefault();
                return;
            }
            if (hitIndex !== -1) {
                state.pendingPointIndex = hitIndex;
                state.pendingStartX = e.clientX;
                state.pendingStartY = e.clientY;
                viewport.setPointerCapture(e.pointerId);
                e.preventDefault();
            }
            return;
        }

		if (state.mode === 'add' || state.mode === 'delete'
			|| state.mode === 'economy' || state.mode === 'neighbours') {
			const coords = getImageCoords(e, viewport, state.scale, state.translateX, state.translateY);
			state.pointerDownInfo = {
				x: e.clientX, y: e.clientY,
				imageX: coords.imageX, imageY: coords.imageY,
				time: Date.now()
			};
			e.preventDefault();
		}
    });

    viewport.addEventListener('pointermove', (e) => {
        // Редактор: рисование
		if (state.mode === 'editor' && state.isDrawing) {
			const coords = getImageCoords(e, viewport, state.scale, state.translateX, state.translateY);
			state.liveStrokePoints.push({ x: coords.imageX, y: coords.imageY });
			renderLiveStroke();
			renderEditor(overlay, state.points, state.editorColors,
						 state.fillAlpha, state.strokeColor, state.strokeAlpha);
			e.preventDefault();
			return;
		}
        if (state.mode === 'editor') return; // другие события в редакторе игнорируем

        // Обычный режим
        if (state.draggedPointIndex === -1 && state.followPointIndex === -1 && state.pendingPointIndex === -1) {
            updateHover(e, viewport, overlay);
        }

        if (state.followPointIndex !== -1) {
            const coords = getImageCoords(e, viewport, state.scale, state.translateX, state.translateY);
            const p = state.points[state.followPointIndex];
            p.x = coords.imageX;
            p.y = coords.imageY;
            state.cellsCanvas = null;
            redrawPoints(overlay);
            e.preventDefault();
            return;
        }

        if (state.draggedPointIndex !== -1) {
            const coords = getImageCoords(e, viewport, state.scale, state.translateX, state.translateY);
            const p = state.points[state.draggedPointIndex];
            p.x = coords.imageX - state.dragOffsetX;
            p.y = coords.imageY - state.dragOffsetY;
            state.cellsCanvas = null;
            redrawPoints(overlay);
            e.preventDefault();
            return;
        }

        if (state.pendingPointIndex !== -1) {
            const dx = e.clientX - state.pendingStartX;
            const dy = e.clientY - state.pendingStartY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > DRAG_THRESHOLD) {
                state.draggedPointIndex = state.pendingPointIndex;
                state.pendingPointIndex = -1;
                const coords = getImageCoords(e, viewport, state.scale, state.translateX, state.translateY);
                const p = state.points[state.draggedPointIndex];
                state.dragOffsetX = coords.imageX - p.x;
                state.dragOffsetY = coords.imageY - p.y;
                viewport.style.cursor = 'grabbing';
                redrawPoints(overlay);
            }
            e.preventDefault();
            return;
        }

        if (state.isPanning) {
            state.translateX = state.panLastX + (e.clientX - state.panStartX);
            state.translateY = state.panLastY + (e.clientY - state.panStartY);
            applyTransform(preview, overlay);
            e.preventDefault();
        }
    });

    viewport.addEventListener('pointerup', (e) => {
        // Редактор: завершение рисования
		if (state.mode === 'editor' && state.isDrawing) {
			commitLiveStroke();
			state.isDrawing = false;
			renderEditor(overlay, state.points, state.editorColors,
						 state.fillAlpha, state.strokeColor, state.strokeAlpha);
			e.preventDefault();
			return;
		}
        if (state.mode === 'editor') return;

        if (e.button !== 0) return;

        if (state.draggedPointIndex !== -1) {
            state.draggedPointIndex = -1;
            viewport.releasePointerCapture(e.pointerId);
            updateCursor(viewport);
            e.preventDefault();
            return;
        }

        if (state.pendingPointIndex !== -1) {
            state.followPointIndex = state.pendingPointIndex;
            state.pendingPointIndex = -1;
            viewport.releasePointerCapture(e.pointerId);
            viewport.style.cursor = 'grabbing';
            redrawPoints(overlay);
            updateCursor(viewport);
            e.preventDefault();
            return;
        }

        if (state.isPanning) {
            state.isPanning = false;
            viewport.releasePointerCapture(e.pointerId);
            viewport.style.cursor = 'grab';
            e.preventDefault();
            return;
        }

        if (state.pointerDownInfo) {
            const dx = e.clientX - state.pointerDownInfo.x;
            const dy = e.clientY - state.pointerDownInfo.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const dt = Date.now() - state.pointerDownInfo.time;
            if (dist < 5 && dt < 300) {
                const now = Date.now();
                const lastDist = Math.hypot(e.clientX - state.lastActionClickX, e.clientY - state.lastActionClickY);
                if (now - state.lastActionClickTime < 300 && lastDist < 5) {
                    state.lastActionClickTime = 0;
                } else {
                    const imageX = state.pointerDownInfo.imageX;
                    const imageY = state.pointerDownInfo.imageY;
                    if (imageX >= 0 && imageX <= overlay.width && imageY >= 0 && imageY <= overlay.height) {
                        
						if (state.mode === 'add') {
							addPoint(imageX, imageY);
							redrawPoints(overlay);
						} else if (state.mode === 'delete') {
							const idx = hitTestPoint(state.points, imageX, imageY, getInteractionRadiusImage(state.scale));
							if (idx !== -1) {
								removePoint(idx);
								state.hoveredPointIndex = -1;
								redrawPoints(overlay);
							}
						} else if (state.mode === 'economy') {
							const idx = hitTestTile(state.points, imageX, imageY, overlay.width, overlay.height);
							if (idx >= 0) onEconomyTileClick(idx);
						} else if (state.mode === 'neighbours') {
							const idx = hitTestTile(state.points, imageX, imageY, overlay.width, overlay.height);
							if (idx >= 0) onNeighboursTileClick(idx);
						}
						
                    }
                    state.lastActionClickTime = now;
                    state.lastActionClickX = e.clientX;
                    state.lastActionClickY = e.clientY;
                }
            }
            state.pointerDownInfo = null;
            updateCursor(viewport);
        }
    });

    viewport.addEventListener('pointercancel', (e) => {
        if (state.mode === 'editor') {
            state.isDrawing = false;
            return;
        }

        state.draggedPointIndex = -1;
        state.pendingPointIndex = -1;
        state.isPanning = false;
        state.pointerDownInfo = null;
        state.hoveredPointIndex = -1;
        state.followPointIndex = -1;
        viewport.releasePointerCapture(e.pointerId);
        redrawPoints(overlay);
        updateCursor(viewport);
    });

    viewport.addEventListener('pointerleave', () => {
        if (state.mode === 'editor') {
            if (state.isDrawing) state.isDrawing = false;
            return;
        }

        if (state.hoveredPointIndex !== -1) {
            state.hoveredPointIndex = -1;
            redrawPoints(overlay);
        }
        if (state.isPanning) {
            state.isPanning = false;
            viewport.style.cursor = 'grab';
        }
        updateCursor(viewport);
    });

    viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = viewport.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        zoomAt(mouseX, mouseY, factor, viewport, preview, overlay);
    }, { passive: false });

    viewport.addEventListener('dblclick', (e) => {
        if (state.mode === 'pan' || state.mode === 'editor') {
            e.preventDefault();
            fitToScreen(viewport, preview, overlay);
        }
    });

    window.addEventListener('keydown', (e) => {
		const t = e.target;
		if (t instanceof HTMLInputElement
			|| t instanceof HTMLTextAreaElement
			|| (t instanceof HTMLElement && t.isContentEditable)) {
			if (e.code === 'Escape') { t.blur(); e.preventDefault(); }
			return;
		}

		const STEP = 50;
		const ZOOM_STEP = 1.1;

        if (state.mode === 'editor') {
            // A/R/C — это режимы точек, в редакторе они не нужны.
            // E/N — выход в «Соседи»/«Экономику», разрешаем.
            if (['KeyA', 'KeyR', 'KeyC'].includes(e.code)) {
                e.preventDefault();
                return;
            }
        }

		switch (e.code) {
            case 'Equal':
                e.preventDefault();
                zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, ZOOM_STEP, viewport, preview, overlay);
                break;
            case 'Minus':
                e.preventDefault();
                zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, 1 / ZOOM_STEP, viewport, preview, overlay);
                break;
            case 'Digit0':
                e.preventDefault();
                fitToScreen(viewport, preview, overlay);
                break;
            case 'ArrowLeft':
                e.preventDefault();
                state.translateX += STEP;
                applyTransform(preview, overlay);
                break;
            case 'ArrowRight':
                e.preventDefault();
                state.translateX -= STEP;
                applyTransform(preview, overlay);
                break;
            case 'ArrowUp':
                e.preventDefault();
                state.translateY += STEP;
                applyTransform(preview, overlay);
                break;
            case 'ArrowDown':
                e.preventDefault();
                state.translateY -= STEP;
                applyTransform(preview, overlay);
                break;
            case 'KeyA':
                if (state.mode !== 'editor') {
                    e.preventDefault();
                    setMode('add');
                    updateButtons();
                    redrawPoints(overlay);
                    updateCursor(viewport);
                }
                break;
            case 'KeyR':
                if (state.mode !== 'editor') {
                    e.preventDefault();
                    setMode('delete');
                    updateButtons();
                    redrawPoints(overlay);
                    updateCursor(viewport);
                }
                break;
            case 'KeyC':
                if (state.mode !== 'editor') {
                    e.preventDefault();
                    setMode('move');
                    updateButtons();
                    redrawPoints(overlay);
                    updateCursor(viewport);
                }
                break;
        case 'KeyE':
            e.preventDefault();
            switchMode('economy');
            break;
        case 'KeyN':
            e.preventDefault();
            switchMode('neighbours');
            break;
        }
    });
}