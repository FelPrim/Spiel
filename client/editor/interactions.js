import { state, setMode, addPoint, removePoint, DRAG_THRESHOLD } from './state.js';
import { updateButtons } from './main.js';
import {
    getBaseCursor,
    getImageCoords,
    getInteractionRadiusImage,
    hitTestPoint,
    intToRgb
} from './utils.js';
import { redrawPoints, applyTransform, fitToScreen, zoomAt, renderEditor } from './rendering.js';

// Вспомогательные функции для рисования кистью
function drawBrushDot(x, y) {
    if (!state.brushCanvas) return;
    const ctx = state.brushCanvas.getContext('2d');
    const radius = state.brushSize / state.scale;
    // глобальная прозрачность теперь применяется при наложении слоя
    ctx.globalAlpha = 1.0;
    ctx.fillStyle = `rgb(${state.brushColor[0]}, ${state.brushColor[1]}, ${state.brushColor[2]})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
}

function drawBrushLine(x0, y0, x1, y1) {
    if (!state.brushCanvas) return;
    const ctx = state.brushCanvas.getContext('2d');
    const radius = state.brushSize / state.scale;
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = `rgb(${state.brushColor[0]}, ${state.brushColor[1]}, ${state.brushColor[2]})`;
    ctx.lineWidth = radius * 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
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
                // Начать рисование
                state.isDrawing = true;
                state.lastDrawX = imageX;
                state.lastDrawY = imageY;
                drawBrushDot(imageX, imageY);
                renderEditor(overlay, state.points, state.editorColors, state.fillAlpha, state.strokeColor, state.strokeAlpha);
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

        if (state.mode === 'add' || state.mode === 'delete') {
            const coords = getImageCoords(e, viewport, state.scale, state.translateX, state.translateY);
            state.pointerDownInfo = {
                x: e.clientX,
                y: e.clientY,
                imageX: coords.imageX,
                imageY: coords.imageY,
                time: Date.now()
            };
            e.preventDefault();
        }
    });

    viewport.addEventListener('pointermove', (e) => {
        // Редактор: рисование
        if (state.mode === 'editor' && state.isDrawing) {
            const coords = getImageCoords(e, viewport, state.scale, state.translateX, state.translateY);
            const x = coords.imageX;
            const y = coords.imageY;
            drawBrushLine(state.lastDrawX, state.lastDrawY, x, y);
            state.lastDrawX = x;
            state.lastDrawY = y;
            renderEditor(overlay, state.points, state.editorColors, state.fillAlpha, state.strokeColor, state.strokeAlpha);
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
            redrawPoints(overlay);
            e.preventDefault();
            return;
        }

        if (state.draggedPointIndex !== -1) {
            const coords = getImageCoords(e, viewport, state.scale, state.translateX, state.translateY);
            const p = state.points[state.draggedPointIndex];
            p.x = coords.imageX - state.dragOffsetX;
            p.y = coords.imageY - state.dragOffsetY;
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
            state.isDrawing = false;
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
        const STEP = 50;
        const ZOOM_STEP = 1.1;

        // Запрещаем клавиши переключения режимов в редакторе
        if (state.mode === 'editor') {
            if (['KeyA', 'KeyR', 'KeyC'].includes(e.code)) {
                e.preventDefault();
                return;
            }
            // остальные клавиши работают
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
        }
    });
}