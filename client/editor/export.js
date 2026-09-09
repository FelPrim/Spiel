import { state } from './state.js';
import { generateUniqueColors, intToRgb } from './utils.js';

export async function exportVoronoi(overlay, downloadElement) {
    if (state.points.length < 2) {
        alert('Нужно минимум 2 точки для построения диаграммы Вороного.');
        return;
    }
    if (!state.originalFile) {
        alert('Исходное изображение не найдено.');
        return;
    }

    const width = overlay.width;
    const height = overlay.height;
    if (!width || !height) return;

    // Создаём canvas для PNG диаграммы
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = width;
    exportCanvas.height = height;
    const ctx = exportCanvas.getContext('2d');

    const delaunay = d3.Delaunay.from(state.points.map(p => [p.x, p.y]));
    const voronoi = delaunay.voronoi([0, 0, width, height]);

    const colors = state.editorColors || generateUniqueColors(state.points.length);

    // Рисуем ячейки на временном canvas
    const cellsCanvas = document.createElement('canvas');
    cellsCanvas.width = width;
    cellsCanvas.height = height;
    const cellsCtx = cellsCanvas.getContext('2d');
    for (let i = 0; i < state.points.length; i++) {
        const [r, g, b] = intToRgb(colors[i]);
        cellsCtx.beginPath();
        voronoi.renderCell(i, cellsCtx);
        cellsCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        cellsCtx.fill();
    }

    // Накладываем ячейки с прозрачностью
    ctx.globalAlpha = state.fillAlpha;
    ctx.drawImage(cellsCanvas, 0, 0);
    ctx.globalAlpha = 1.0;

    // Накладываем мазки кисти
    if (state.brushCanvas) {
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = width;
        maskCanvas.height = height;
        const maskCtx = maskCanvas.getContext('2d');
        maskCtx.drawImage(state.brushCanvas, 0, 0);

        ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(maskCanvas, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = state.fillAlpha;
        ctx.drawImage(maskCanvas, 0, 0);
        ctx.globalAlpha = 1.0;
    }

    // Преобразуем PNG canvas в blob
    const pngBlob = await new Promise(resolve => exportCanvas.toBlob(resolve, 'image/png'));

    // Генерируем JSON
    const points = state.points.map(p => ({ x: p.x, y: p.y }));
    const neighbours = [];
    let neighbours_len = 0;
    for (let i = 0; i < state.points.length; i++) {
        const n = Array.from(voronoi.neighbors(i));
        neighbours.push(n);
        neighbours_len += n.length;
    }
    const graphData = {
        tilecount: state.points.length,
        neighbours_len: neighbours_len,
        points: points,
        colors: colors,
        neighbours: neighbours
    };
    const jsonBlob = new Blob([JSON.stringify(graphData, null, 2)], { type: 'application/json' });

    // Получаем имя и расширение исходного файла
    const originalName = state.originalFile.name;
    const ext = originalName.split('.').pop();
    const baseName = originalName.replace(/\.[^/.]+$/, '');

    // Создаём ZIP
    const zip = new JSZip();
    zip.file(`map.${ext}`, state.originalFile);
    zip.file('voronoj.png', pngBlob);
    zip.file('info.json', jsonBlob);

    const zipBlob = await zip.generateAsync({ type: 'blob' });

    // Скачиваем архив
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}.spielmap`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}