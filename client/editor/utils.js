import { POINT_RADIUS_SCREEN, INTERACTION_MULTIPLIER } from './state.js';

export function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

export function getVisualRadiusImage(scale) {
    return POINT_RADIUS_SCREEN / scale;
}

export function getInteractionRadiusImage(scale) {
    return getVisualRadiusImage(scale) * INTERACTION_MULTIPLIER;
}

export function getImageCoords(e, viewport, scale, translateX, translateY) {
    const rect = viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const imageX = (mouseX - translateX) / scale;
    const imageY = (mouseY - translateY) / scale;
    return { mouseX, mouseY, imageX, imageY };
}

export function hitTestPoint(points, imageX, imageY, radius) {
    for (let i = points.length - 1; i >= 0; i--) {
        const p = points[i];
        const dx = p.x - imageX;
        const dy = p.y - imageY;
        if (Math.sqrt(dx * dx + dy * dy) <= radius) {
            return i;
        }
    }
    return -1;
}

export function getBaseCursor(mode) {
    switch (mode) {
        case 'pan': return 'grab';
        case 'add': return 'crosshair';
        case 'economy':
        case 'neighbours': return 'pointer';
        case 'delete':
        case 'move': return 'default';
        default: return 'default';
    }
}

/** Соседи из диаграммы Вороного (в тех же границах, что и export.js). */
export function computeVoronoiNeighbours(points, width, height) {
    const n = points.length;
    if (n < 2) return points.map(() => []);
    const delaunay = d3.Delaunay.from(points.map(p => [p.x, p.y]));
    const voronoi = delaunay.voronoi([0, 0, width, height]);
    const result = [];
    for (let i = 0; i < n; i++) {
        result.push(Array.from(voronoi.neighbors(i)));
    }
    return result;
}

/** Индекс тайла под точкой (imageX, imageY); -1 при пустом множестве. */
export function hitTestTile(points, imageX, imageY) {
    if (points.length === 0) return -1;
    // find() у Delaunay возвращает индекс ближайшей точки, что для
    // диаграммы Вороного эквивалентно «ячейка, содержащая (x, y)».
    const delaunay = d3.Delaunay.from(points.map(p => [p.x, p.y]));
    const idx = delaunay.find(imageX, imageY);
    return (idx >= 0 && idx < points.length) ? idx : -1;
}

// Преобразование 24-битного числа в RGB-массив [r, g, b]
export function intToRgb(num) {
    return [(num >> 16) & 0xFF, (num >> 8) & 0xFF, num & 0xFF];
}

// Линейный конгруэнтный генератор для 24-битных цветов
// Параметры выбраны для полного периода (2^24)
const LCG_A = 1664525;
const LCG_C = 1013904223;
const LCG_M = 0x1000000; // 2^24

// Функция генерирует массив из n уникальных 24-битных цветов
export function generateUniqueColors(n) {
    const colors = [];
    let x = 0; // начальное значение (seed)
    for (let i = 0; i < n; i++) {
        x = (LCG_A * x + LCG_C) % LCG_M;
        colors.push(x);
    }
    return colors;
}