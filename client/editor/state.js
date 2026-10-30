export const POINT_RADIUS_SCREEN = 6;
export const INTERACTION_MULTIPLIER = Math.sqrt(2);
export const DRAG_THRESHOLD = 3;
export const DEFAULT_ECONOMY = 1000;

export const state = {
    mode: 'pan',                 // 'pan', 'add', 'delete', 'move', 'editor', 'economy', 'neighbours'
    points: [],
    scale: 1,
    translateX: 0,
    translateY: 0,

    fillColor: '#0096ff',
    fillAlpha: 0.35,
    strokeColor: '#ffffff',
    strokeAlpha: 0.9,

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

    editorTool: 'brush',
    brushColor: [0, 0, 0],
    brushSize: 10,
    brushCanvas: null,
    isDrawing: false,
    lastDrawX: 0,
    lastDrawY: 0,
    cellsCanvas: null,
    originalFile: null,
    editorToolChangeCallback: null,
    combinedCanvas: null,
    liveStrokeCanvas: null,
    liveStrokePoints: [],
    liveStrokeRadius: 0,
    liveStrokeColor: '#000',
    editorColors: null,   // null = пользователь ещё не входил в «Редактор»

    // ---- новые: сценарий (кастомные данные поверх Вороного) ----
    economies: null,               // number[] | null (null = используется DEFAULT_ECONOMY)
    customNeighbours: null,        // number[][] | null (null = используется Вороной)
    selectedTileIndex: -1,         // для режима 'neighbours'
    editingNeighboursMode: false,  // sub-mode внутри 'neighbours'
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
    if (state.economies) state.economies.push(DEFAULT_ECONOMY);
    if (state.customNeighbours) {
        state.customNeighbours.push([]);
        console.warn('[editor] Добавлена точка: новый тайл изолирован в кастомном графе. Отредактируйте соседство.');
    }
    state.cellsCanvas = null;
}

export function removePoint(index) {
    if (index < 0 || index >= state.points.length) return;
    state.points.splice(index, 1);

    if (state.economies) state.economies.splice(index, 1);

    if (state.customNeighbours) {
        const next = [];
        for (let i = 0; i < state.customNeighbours.length; i++) {
            if (i === index) continue;
            const arr = state.customNeighbours[i]
                .filter(n => n !== index)
                .map(n => n > index ? n - 1 : n);
            next.push(arr);
        }
        state.customNeighbours = next;
    }

    if (state.selectedTileIndex >= 0) {
        if (state.selectedTileIndex === index) state.selectedTileIndex = -1;
        else if (state.selectedTileIndex > index) state.selectedTileIndex--;
    }
    state.cellsCanvas = null;
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

    state.editorTool = 'brush';
    state.brushColor = [0, 0, 0];
    state.brushCanvas = null;
    state.isDrawing = false;
    state.liveStrokePoints = [];
    state.liveStrokeCanvas = null;
    state.cellsCanvas = null;
    state.combinedCanvas = null;
    state.editorColors = null;

    // сценарий
    state.economies = null;
    state.customNeighbours = null;
    state.selectedTileIndex = -1;
    state.editingNeighboursMode = false;
}