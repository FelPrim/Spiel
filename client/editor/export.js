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

    const delaunay = d3.Delaunay.from(state.points.map(p => [p.x, p.y]));
    const voronoi = delaunay.voronoi([0, 0, width, height]);

    const colors = state.editorColors || generateUniqueColors(state.points.length);

    // Создаём canvas для voronoj.png (детектор провинций)
    const voronojCanvas = document.createElement('canvas');
    voronojCanvas.width = width;
    voronojCanvas.height = height;
    const vCtx = voronojCanvas.getContext('2d');

    // Рисуем ячейки непрозрачными, без мазков
    for (let i = 0; i < state.points.length; i++) {
        const [r, g, b] = intToRgb(colors[i]);
        vCtx.beginPath();
        voronoi.renderCell(i, vCtx);
        vCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        vCtx.fill();
    }
	if (state.brushCanvas) {
		vCtx.drawImage(state.brushCanvas, 0, 0);
	}
    // PNG для voronoj.png
    const pngBlob = await new Promise(resolve => voronojCanvas.toBlob(resolve, 'image/png'));

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

    // Имя архива
    const originalName = state.originalFile.name;
    const ext = originalName.split('.').pop();
    const baseName = originalName.replace(/\.[^/.]+$/, '');

    // Создаём ZIP
    const zip = new JSZip();
    zip.file(`map.${ext}`, state.originalFile);
    zip.file('voronoj.png', pngBlob);
    zip.file('info.json', jsonBlob);

    const zipBlob = await zip.generateAsync({ type: 'blob' });

    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}.spielmap`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}