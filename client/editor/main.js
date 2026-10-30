import { state, setMode, resetTransientState, DEFAULT_ECONOMY } from './state.js';
import { initInteractions } from './interactions.js';
import { redrawPoints, fitToScreen, renderEditor } from './rendering.js';
import { exportVoronoi } from './export.js';
import { generateUniqueColors, computeVoronoiNeighbours } from './utils.js';

// DOM
const fileInput = document.getElementById('file');
const preview = document.getElementById('preview');
const overlay = document.getElementById('overlay');
const download = document.getElementById('download');
const viewport = document.getElementById('viewport');

const btnAdd = document.getElementById('mode-add');
const btnDelete = document.getElementById('mode-delete');
const btnMove = document.getElementById('mode-move');
const btnEditor = document.getElementById('mode-editor');
const btnEconomy = document.getElementById('mode-economy');
const btnNeighbours = document.getElementById('mode-neighbours');
const btnBack = document.getElementById('back-to-viewer');
const eyedropperBtn = document.getElementById('eyedropper');

const fillColorInput = document.getElementById('fill-color');
const fillAlphaInput = document.getElementById('fill-alpha');
const strokeColorInput = document.getElementById('stroke-color');
const strokeAlphaInput = document.getElementById('stroke-alpha');

const editorFillAlpha = document.getElementById('editor-fill-alpha');
const editorStrokeColor = document.getElementById('editor-stroke-color');
const editorStrokeAlpha = document.getElementById('editor-stroke-alpha');
const brushColorInput = document.getElementById('brush-color');
const brushSizeInput = document.getElementById('brush-size');
const brushSizeValue = document.getElementById('brush-size-value');

const btnNeighboursEditor = document.getElementById('mode-neighbours-editor');
const btnEconomyEditor = document.getElementById('mode-economy-editor');

// Neighbours panel
const neighboursPanel = document.getElementById('neighbours-panel');
const neighboursHint = document.getElementById('neighbours-hint');
const neighboursContent = document.getElementById('neighbours-content');
const neighboursSelectedLabel = document.getElementById('neighbours-selected-label');
const neighboursList = document.getElementById('neighbours-list');
const neighboursToggleEdit = document.getElementById('neighbours-toggle-edit');
const neighboursReset = document.getElementById('neighbours-reset');
const neighboursDeselect = document.getElementById('neighbours-deselect');

// Economy modal
const economyModal = document.getElementById('economy-modal');
const economyOverlay = document.getElementById('economy-overlay');
const economyTitle = document.getElementById('economy-title');
const economyInput = document.getElementById('economy-input');
const economyOk = document.getElementById('economy-ok');
const economyCancel = document.getElementById('economy-cancel');

initInteractions(viewport, preview, overlay);

export function updateButtons() {
    btnAdd.classList.toggle('active', state.mode === 'add');
    btnDelete.classList.toggle('active', state.mode === 'delete');
    btnMove.classList.toggle('active', state.mode === 'move');
    btnEconomy.classList.toggle('active', state.mode === 'economy');
    btnNeighbours.classList.toggle('active', state.mode === 'neighbours');

    // Соседи и экономика доступны только после использования редактора
    // (кисти). Критерий — state.editorColors !== null. Устанавливается
    // в enterEditorMode, сбрасывается в resetTransientState (загрузка
    // нового файла).
    const scenarioReady = state.editorColors !== null;
    btnNeighbours.disabled = !scenarioReady;
    btnEconomy.disabled = !scenarioReady;
}

function updateEditorUI() {
    eyedropperBtn.classList.toggle('active', state.editorTool === 'eyedropper');
    const [r, g, b] = state.brushColor;
    const hex = '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
    brushColorInput.value = hex;
}
state.editorToolChangeCallback = updateEditorUI;

function updateCursor() {
    if (state.mode === 'editor') { viewport.style.cursor = 'default'; return; }
    const { mode, hoveredPointIndex, draggedPointIndex, followPointIndex } = state;
    if ((mode === 'delete' || mode === 'move') && hoveredPointIndex !== -1) {
        viewport.style.cursor = 'pointer';
    } else if (mode === 'move' && (draggedPointIndex !== -1 || followPointIndex !== -1)) {
        viewport.style.cursor = 'grabbing';
    } else {
        viewport.style.cursor = ({
            pan: 'grab', add: 'crosshair',
            economy: 'pointer', neighbours: 'pointer',
        })[mode] || 'default';
    }
}

function enterEditorMode() {
    if (!preview.naturalWidth || state.points.length < 2) {
        alert('Загрузите изображение и поставьте минимум 2 точки.');
        return;
    }
    state.liveStrokePoints = [];
    state.liveStrokeCanvas = null;

    // Цвета ячеек: сохраняем, если количество точек не менялось
    // (иначе повторный вход в редактор перекрасит уже закрашенные ячейки).
    if (state.editorColors === null
        || state.editorColors.length !== state.points.length) {
        state.editorColors = generateUniqueColors(state.points.length);
        state.cellsCanvas = null;
    }

    // brushCanvas: создаём только если его нет (или размер изменился);
    // если он уже есть — НЕ чистим, чтобы сохранить ранее нарисованное.
    if (!state.brushCanvas
        || state.brushCanvas.width !== overlay.width
        || state.brushCanvas.height !== overlay.height) {
        state.brushCanvas = document.createElement('canvas');
        state.brushCanvas.width = overlay.width;
        state.brushCanvas.height = overlay.height;
    }

    state.editorTool = 'brush';
    updateEditorUI();
    state.mode = 'editor';
    document.body.classList.add('editor-mode');
    updateButtons();
    renderEditor(overlay, state.points, state.editorColors,
                 state.fillAlpha, state.strokeColor, state.strokeAlpha);
    updateCursor();
}

function exitEditorMode() {
    state.mode = 'pan';
    document.body.classList.remove('editor-mode');
    redrawPoints(overlay);
    updateButtons();
    updateCursor();
    state.liveStrokePoints = [];
    state.liveStrokeCanvas = null;
    state.cellsCanvas = null;
}

/**
 * Универсальный переключатель режимов (не путать с setMode из state.js):
 * выполняет cleanup старого режима (закрытие модалки / снятие выбора)
 * и обновление UI. Используется всеми кнопками и хоткеями.
 */
export function switchMode(newMode) {
    if ((newMode === 'economy' || newMode === 'neighbours')
        && state.editorColors === null) {
        return;   // ещё не прошли этап «Редактор»
    }

    if (state.mode === 'editor' && newMode !== 'editor') exitEditorMode();
    if (state.mode === 'economy' && newMode !== 'economy') closeEconomyModal();
    if (state.mode === 'neighbours' && newMode !== 'neighbours') {
        state.selectedTileIndex = -1;
        state.editingNeighboursMode = false;
    }

    setMode(newMode);
    updateButtons();
    updateCursor();
    updatePanelsVisibility();
    redrawPoints(overlay);
    if (state.mode === 'neighbours') refreshNeighboursPanel();
}

function updatePanelsVisibility() {
    neighboursPanel.hidden = state.mode !== 'neighbours';
}

btnAdd.addEventListener('click', () => switchMode('add'));
btnDelete.addEventListener('click', () => switchMode('delete'));
btnMove.addEventListener('click', () => switchMode('move'));
btnEconomy.addEventListener('click', () => switchMode('economy'));
btnNeighbours.addEventListener('click', () => switchMode('neighbours'));
btnEconomyEditor.addEventListener('click', () => switchMode('economy'));
btnNeighboursEditor.addEventListener('click', () => switchMode('neighbours'));

btnEditor.addEventListener('click', enterEditorMode);
btnBack.addEventListener('click', exitEditorMode);

eyedropperBtn.addEventListener('click', () => {
    if (state.mode !== 'editor') return;
    state.editorTool = 'eyedropper';
    updateEditorUI();
    updateCursor();
});

fillColorInput.addEventListener('input', (e) => { state.fillColor = e.target.value; if (state.mode !== 'editor') redrawPoints(overlay); });
fillAlphaInput.addEventListener('input', (e) => { state.fillAlpha = parseFloat(e.target.value); if (state.mode !== 'editor') redrawPoints(overlay); });
strokeColorInput.addEventListener('input', (e) => { state.strokeColor = e.target.value; if (state.mode !== 'editor') redrawPoints(overlay); });
strokeAlphaInput.addEventListener('input', (e) => { state.strokeAlpha = parseFloat(e.target.value); if (state.mode !== 'editor') redrawPoints(overlay); });

editorFillAlpha.addEventListener('input', (e) => {
    state.fillAlpha = parseFloat(e.target.value);
    if (state.mode === 'editor') renderEditor(overlay, state.points, state.editorColors, state.fillAlpha, state.strokeColor, state.strokeAlpha);
});
editorStrokeColor.addEventListener('input', (e) => {
    state.strokeColor = e.target.value;
    if (state.mode === 'editor') renderEditor(overlay, state.points, state.editorColors, state.fillAlpha, state.strokeColor, state.strokeAlpha);
});
editorStrokeAlpha.addEventListener('input', (e) => {
    state.strokeAlpha = parseFloat(e.target.value);
    if (state.mode === 'editor') renderEditor(overlay, state.points, state.editorColors, state.fillAlpha, state.strokeColor, state.strokeAlpha);
});

brushSizeInput.addEventListener('input', (e) => {
    state.brushSize = parseInt(e.target.value);
    brushSizeValue.textContent = state.brushSize;
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    state.originalFile = file;
    if (preview.src && preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
    const url = URL.createObjectURL(file);
    preview.src = url;
    download.href = url;
    download.download = file.name;
    download.disabled = false;

    preview.onload = () => {
        overlay.width = preview.naturalWidth;
        overlay.height = preview.naturalHeight;
        resetTransientState();
        fitToScreen(viewport, preview, overlay);
        switchMode('pan');
    };
});

download.addEventListener('click', (e) => {
    e.preventDefault();
    if (download.disabled) return;
    exportVoronoi(overlay, download);
});

// ==================== Economy modal ====================

let economyTargetTile = -1;

function openEconomyModal(tileIndex) {
    economyTargetTile = tileIndex;
    if (!state.economies) {
        state.economies = new Array(state.points.length).fill(DEFAULT_ECONOMY);
    }
    economyTitle.textContent = `Экономика провинции #${tileIndex}`;
    economyInput.value = String(state.economies[tileIndex] ?? DEFAULT_ECONOMY);
    economyModal.hidden = false;
    economyInput.focus();
    economyInput.select();
}

function closeEconomyModal() {
    economyModal.hidden = true;
    economyTargetTile = -1;
}

economyInput.addEventListener('input', () => {
    economyInput.value = economyInput.value.replace(/\D/g, '');
});

economyOk.addEventListener('click', () => {
    if (economyTargetTile < 0 || !state.economies) { closeEconomyModal(); return; }
    const raw = economyInput.value.replace(/\D/g, '');
    const value = raw === '' ? 0 : parseInt(raw, 10);
    state.economies[economyTargetTile] = value;
    closeEconomyModal();
    redrawPoints(overlay);
});

economyCancel.addEventListener('click', closeEconomyModal);
economyOverlay.addEventListener('click', closeEconomyModal);

// ==================== Neighbours panel ====================

function ensureCustomNeighbours() {
    if (!state.customNeighbours) {
        state.customNeighbours = computeVoronoiNeighbours(
            state.points, overlay.width, overlay.height,
        );
    }
}

function toggleNeighbour(a, b) {
    if (a === b || !state.customNeighbours) return;
    const custom = state.customNeighbours;
    if (custom[a]?.includes(b)) {
        custom[a] = custom[a].filter(x => x !== b);
        custom[b] = custom[b].filter(x => x !== a);
    } else {
        if (!custom[a].includes(b)) custom[a].push(b);
        if (!custom[b].includes(a)) custom[b].push(a);
    }
    refreshNeighboursPanel();
    redrawPoints(overlay);
}

function refreshNeighboursPanel() {
    if (state.mode !== 'neighbours') { neighboursPanel.hidden = true; return; }
    neighboursPanel.hidden = false;

    const sel = state.selectedTileIndex;
    if (sel < 0) {
        neighboursHint.textContent = 'Кликните провинцию, чтобы увидеть её соседей.';
        neighboursHint.hidden = false;
        neighboursContent.hidden = true;
        return;
    }

    const neighbours = state.customNeighbours
        || computeVoronoiNeighbours(state.points, overlay.width, overlay.height);
    const list = neighbours[sel] ?? [];

    if (state.editingNeighboursMode) {
        neighboursHint.textContent = `Кликните провинцию, чтобы добавить/удалить соседство с #${sel}.`;
        neighboursHint.hidden = false;
    } else {
        neighboursHint.hidden = true;
    }
    neighboursContent.hidden = false;

    neighboursSelectedLabel.textContent = `Провинция #${sel} · соседей: ${list.length}`;

    neighboursList.innerHTML = '';
    if (list.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'Нет соседей';
        li.style.opacity = '0.6';
        li.style.fontStyle = 'italic';
        neighboursList.appendChild(li);
    } else {
        for (const n of [...list].sort((a, b) => a - b)) {
            const li = document.createElement('li');
            const span = document.createElement('span');
            span.textContent = `#${n}`;
            li.appendChild(span);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = '×';
            btn.title = 'Удалить соседство';
            btn.addEventListener('click', () => {
                ensureCustomNeighbours();
                toggleNeighbour(sel, n);
            });
            li.appendChild(btn);
            neighboursList.appendChild(li);
        }
    }

    neighboursToggleEdit.classList.toggle('active', state.editingNeighboursMode);
    neighboursToggleEdit.textContent = state.editingNeighboursMode ? 'Готово' : 'Изменить соседство';
}

neighboursToggleEdit.addEventListener('click', () => {
    if (state.selectedTileIndex < 0) return;
    state.editingNeighboursMode = !state.editingNeighboursMode;
    refreshNeighboursPanel();
    redrawPoints(overlay);
});

neighboursReset.addEventListener('click', () => {
    state.customNeighbours = null;
    refreshNeighboursPanel();
    redrawPoints(overlay);
});

neighboursDeselect.addEventListener('click', () => {
    state.selectedTileIndex = -1;
    state.editingNeighboursMode = false;
    refreshNeighboursPanel();
    redrawPoints(overlay);
});

// ==================== Экспорт обработчиков в interactions.js ====================

export function onEconomyTileClick(tileIdx) {
    if (tileIdx < 0) return;
    openEconomyModal(tileIdx);
}

export function onNeighboursTileClick(tileIdx) {
    if (tileIdx < 0) return;
    if (state.editingNeighboursMode && state.selectedTileIndex >= 0) {
        ensureCustomNeighbours();
        toggleNeighbour(state.selectedTileIndex, tileIdx);
    } else {
        state.selectedTileIndex = tileIdx;
        refreshNeighboursPanel();
        redrawPoints(overlay);
    }
}

// ==================== Init ====================

download.disabled = true;
updateCursor();
updatePanelsVisibility();