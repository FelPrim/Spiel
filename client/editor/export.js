import { state } from './state.js';
import { generateUniqueColors, intToRgb } from './utils.js';

export function exportVoronoi(overlay, downloadElement) {
    if (state.points.length < 2) {
        alert('Нужно минимум 2 точки для построения диаграммы Вороного.');
        return;
    }

    const width = overlay.width;
    const height = overlay.height;
    if (!width || !height) return;

    // Создаём экспортный canvas для PNG
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = width;
    exportCanvas.height = height;
    const ctx = exportCanvas.getContext('2d');

    const delaunay = d3.Delaunay.from(state.points.map(p => [p.x, p.y]));
    const voronoi = delaunay.voronoi([0, 0, width, height]);

    const colors = state.editorColors || generateUniqueColors(state.points.length);

    // Временный canvas для ячеек без прозрачности
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

    ctx.globalAlpha = state.fillAlpha;
    ctx.drawImage(cellsCanvas, 0, 0);
    ctx.globalAlpha = 1.0;

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

    // Скачиваем PNG
    exportCanvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'voronoi.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 'image/png');

    // Генерируем данные для JSON
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
    const jsonUrl = URL.createObjectURL(jsonBlob);
    const aJson = document.createElement('a');
    aJson.href = jsonUrl;
    aJson.download = 'voronoi_graph.json';
    document.body.appendChild(aJson);
    aJson.click();
    document.body.removeChild(aJson);
    URL.revokeObjectURL(jsonUrl);
}