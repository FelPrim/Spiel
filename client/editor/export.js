import { state } from './state.js';
import { generateUniqueColors, intToRgb, computeVoronoiNeighbours } from './utils.js';

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
        const colorStr = `rgb(${r}, ${g}, ${b})`;
        
        vCtx.beginPath();
        voronoi.renderCell(i, vCtx);
        vCtx.fillStyle = colorStr;
        vCtx.fill();
        
        // КРИТИЧЕСКИ ВАЖНО: обводка закрывает AA-швы 
        // (антиалиасинговые зазоры) между соседними ячейками
        vCtx.strokeStyle = colorStr;
        vCtx.lineWidth = 1;
        vCtx.stroke();
    }
	if (state.brushCanvas) {
		vCtx.drawImage(state.brushCanvas, 0, 0);
	}
    // PNG для voronoj.png
    const pngBlob = await new Promise(resolve => voronojCanvas.toBlob(resolve, 'image/png'));

    // Генерируем JSON
    const points = state.points.map(p => ({ x: p.x, y: p.y }));
    
	// Neighbours: кастомный граф или из Вороного
	let neighbours;
	if (state.customNeighbours) {
		neighbours = state.customNeighbours.map(arr => [...arr]);
	} else {
		neighbours = [];
		for (let i = 0; i < state.points.length; i++) {
			neighbours.push(Array.from(voronoi.neighbors(i)));
		}
	}
	let neighbours_len = 0;
	for (const n of neighbours) neighbours_len += n.length;

	const graphData = {
		tilecount: state.points.length,
		neighbours_len,
		points: state.points.map(p => ({ x: p.x, y: p.y })),
		colors,
		neighbours,
	};
	if (state.economies) {
		graphData.economies = [...state.economies];
	}
	
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