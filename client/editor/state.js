export const POINT_RADIUS_SCREEN = 6;
export const INTERACTION_MULTIPLIER = Math.sqrt(2);
export const DRAG_THRESHOLD = 3;

export const state = {
    mode: 'pan',                 // 'pan', 'add', 'delete', 'move', 'editor'
    points: [],
    scale: 1,
    translateX: 0,
    translateY: 0,

    fillColor: '#0096ff',
    fillAlpha: 0.35,
    strokeColor: '#ffffff',
    strokeAlpha: 0.9,

    // Временные состояния указателя
    isPanning: false,
    panStartX: 0,
    panStartY: 0,
    panLastX: 0,
    panLastY: 0,

    hoveredPointIndex: -1,
    draggedPointIndex: -1,
    followPointIndex: -1,
    pendingPointIndex: -1,
    pendingStartX: 0,
    pendingStartY: 0,
    dragOffsetX: 0,
    dragOffsetY: 0,

    pointerDownInfo: null,
    lastActionClickTime: 0,
    lastActionClickX: 0,
    lastActionClickY: 0,

    // Редактор
    editorTool: 'brush',           // 'brush' | 'eyedropper'
    brushColor: [0, 0, 0],         // RGB
    brushSize: 10,                 // в экранных пикселях
    brushCanvas: null,             // offscreen canvas для мазков
    isDrawing: false,
    lastDrawX: 0,
    lastDrawY: 0,
    cellsCanvas: null,
	editorToolChangeCallback: null // устанавливается в main.js
};

export function setMode(newMode) {
    if (state.mode === newMode && newMode !== 'pan') {
        newMode = 'pan';
    }
    state.mode = newMode;
    state.hoveredPointIndex = -1;
    state.draggedPointIndex = -1;
    state.followPointIndex = -1;
    state.pendingPointIndex = -1;
    state.lastActionClickTime = 0;
    state.pointerDownInfo = null;
}

export function addPoint(x, y) {
    state.points.push({ x, y });
}

export function removePoint(index) {
    if (index >= 0 && index < state.points.length) {
        state.points.splice(index, 1);
    }
}

export function clearPoints() {
    state.points.length = 0;
}

export function resetTransientState() {
    state.points.length = 0;
    state.hoveredPointIndex = -1;
    state.draggedPointIndex = -1;
    state.followPointIndex = -1;
    state.pendingPointIndex = -1;
    state.lastActionClickTime = 0;
    state.pointerDownInfo = null;
    // сброс редактора
    state.editorTool = 'brush';
    state.brushColor = [0, 0, 0];
    state.brushCanvas = null;
    state.isDrawing = false;
}