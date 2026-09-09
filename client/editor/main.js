import { state, setMode, resetTransientState } from './state.js';
import { initInteractions } from './interactions.js';
import { redrawPoints, fitToScreen, renderEditor } from './rendering.js';
import { exportVoronoi } from './export.js';
import { generateUniqueColors } from './utils.js';

// DOM-элементы
const fileInput = document.getElementById('file');
const preview = document.getElementById('preview');
const overlay = document.getElementById('overlay');
const download = document.getElementById('download');
const viewport = document.getElementById('viewport');


const btnAdd = document.getElementById('mode-add');
const btnDelete = document.getElementById('mode-delete');
const btnMove = document.getElementById('mode-move');
const btnEditor = document.getElementById('mode-editor');
const btnBack = document.getElementById('back-to-viewer');
const eyedropperBtn = document.getElementById('eyedropper');

const fillColorInput = document.getElementById('fill-color');
const fillAlphaInput = document.getElementById('fill-alpha');
const strokeColorInput = document.getElementById('stroke-color');
const strokeAlphaInput = document.getElementById('stroke-alpha');

// Элементы редактора
const editorFillAlpha = document.getElementById('editor-fill-alpha');
const editorStrokeColor = document.getElementById('editor-stroke-color');
const editorStrokeAlpha = document.getElementById('editor-stroke-alpha');
const brushColorInput = document.getElementById('brush-color');
const brushSizeInput = document.getElementById('brush-size');
const brushSizeValue = document.getElementById('brush-size-value');

// Инициализация обработчиков взаимодействия
initInteractions(viewport, preview, overlay);

// Функция обновления активных кнопок
export function updateButtons() {
    btnAdd.classList.toggle('active', state.mode === 'add');
    btnDelete.classList.toggle('active', state.mode === 'delete');
    btnMove.classList.toggle('active', state.mode === 'move');
}

// Обновление UI редактора (кнопка пипетки, цвет кисти)
function updateEditorUI() {
    eyedropperBtn.classList.toggle('active', state.editorTool === 'eyedropper');
    const [r, g, b] = state.brushColor;
    const hex = '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
    brushColorInput.value = hex;
}
state.editorToolChangeCallback = updateEditorUI;

// Функция обновления курсора
function updateCursor() {
    if (state.mode === 'editor') {
        viewport.style.cursor = 'default';
        return;
    }
    const { mode, hoveredPointIndex, draggedPointIndex, followPointIndex } = state;
    if ((mode === 'delete' || mode === 'move') && hoveredPointIndex !== -1) {
        viewport.style.cursor = 'pointer';
    } else if (mode === 'move' && (draggedPointIndex !== -1 || followPointIndex !== -1)) {
        viewport.style.cursor = 'grabbing';
    } else {
        switch (mode) {
            case 'pan': viewport.style.cursor = 'grab'; break;
            case 'add': viewport.style.cursor = 'crosshair'; break;
            default: viewport.style.cursor = 'default';
        }
    }
}

// Вход в режим редактора (цветные ячейки)
function enterEditorMode() {
    if (!preview.naturalWidth || state.points.length < 2) {
        alert('Загрузите изображение и поставьте минимум 2 точки.');
        return;
    }
    state.editorColors = generateUniqueColors(state.points.length);

    if (!state.brushCanvas) {
        state.brushCanvas = document.createElement('canvas');
        state.brushCanvas.width = overlay.width;
        state.brushCanvas.height = overlay.height;
    }
    const brushCtx = state.brushCanvas.getContext('2d');
    brushCtx.clearRect(0, 0, state.brushCanvas.width, state.brushCanvas.height);

    state.editorTool = 'brush';
    updateEditorUI();
    state.mode = 'editor';
    document.body.classList.add('editor-mode');
   // document.body.classList.remove('show-controls'); // скрываем панель точек
    updateButtons();
    state.cellsCanvas = null;
	renderEditor(overlay, state.points, state.editorColors, 
             state.fillAlpha, state.strokeColor, state.strokeAlpha);
    updateCursor();
}

// Выход из режима редактора (цветные ячейки) в обычный
function exitEditorMode() {
    state.mode = 'pan';
    document.body.classList.remove('editor-mode');
  //  document.body.classList.add('show-controls'); // снова показываем панель точек
    redrawPoints(overlay);
    updateButtons();
    updateCursor();
	state.cellsCanvas = null;
}

// Обработчики кнопок режимов
btnAdd.addEventListener('click', () => {
    if (state.mode === 'editor') exitEditorMode();
    setMode('add');
    updateButtons();
    redrawPoints(overlay);
    updateCursor();
});
btnDelete.addEventListener('click', () => {
    if (state.mode === 'editor') exitEditorMode();
    setMode('delete');
    updateButtons();
    redrawPoints(overlay);
    updateCursor();
});
btnMove.addEventListener('click', () => {
    if (state.mode === 'editor') exitEditorMode();
    setMode('move');
    updateButtons();
    redrawPoints(overlay);
    updateCursor();
});

btnEditor.addEventListener('click', enterEditorMode);
btnBack.addEventListener('click', exitEditorMode);

eyedropperBtn.addEventListener('click', () => {
    if (state.mode !== 'editor') return;
    state.editorTool = 'eyedropper';
    updateEditorUI();
    updateCursor();
});

// Обработчики стилей (обычный режим)
fillColorInput.addEventListener('input', (e) => {
    state.fillColor = e.target.value;
    if (state.mode !== 'editor') redrawPoints(overlay);
});
fillAlphaInput.addEventListener('input', (e) => {
    state.fillAlpha = parseFloat(e.target.value);
    if (state.mode !== 'editor') redrawPoints(overlay);
});
strokeColorInput.addEventListener('input', (e) => {
    state.strokeColor = e.target.value;
    if (state.mode !== 'editor') redrawPoints(overlay);
});
strokeAlphaInput.addEventListener('input', (e) => {
    state.strokeAlpha = parseFloat(e.target.value);
    if (state.mode !== 'editor') redrawPoints(overlay);
});

// Обработчики стилей (режим редактора)
editorFillAlpha.addEventListener('input', (e) => {
    state.fillAlpha = parseFloat(e.target.value);
    if (state.mode === 'editor') {
        renderEditor(overlay, state.points, state.editorColors, 
                     state.fillAlpha, state.strokeColor, state.strokeAlpha);
    }
});
editorStrokeColor.addEventListener('input', (e) => {
    state.strokeColor = e.target.value;
    if (state.mode === 'editor') {
        renderEditor(overlay, state.points, state.editorColors, 
                     state.fillAlpha, state.strokeColor, state.strokeAlpha);
    }
});
editorStrokeAlpha.addEventListener('input', (e) => {
    state.strokeAlpha = parseFloat(e.target.value);
    if (state.mode === 'editor') {
        renderEditor(overlay, state.points, state.editorColors, 
                     state.fillAlpha, state.strokeColor, state.strokeAlpha);
    }
});

// Обновление размера кисти
brushSizeInput.addEventListener('input', (e) => {
    state.brushSize = parseInt(e.target.value);
    brushSizeValue.textContent = state.brushSize;
});

// Загрузка файла
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    state.originalFile = file;
    if (preview.src && preview.src.startsWith('blob:')) {
        URL.revokeObjectURL(preview.src);
    }
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
		if (state.mode === 'editor') exitEditorMode();
		redrawPoints(overlay); // очистим canvas
		updateCursor();
	};
});

// Скачивание диаграммы
download.addEventListener('click', (e) => {
    e.preventDefault();
    if (download.disabled) return;
    exportVoronoi(overlay, download);
});

// Инициализация
download.disabled = true;
updateCursor();