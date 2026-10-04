// client/game/arrow.ts
//
// Отрисовка стрелок приказов поверх карты. Overlay создаётся один раз
// на карту (см. MapView.loadFromBlob) и живёт внутри #map-display,
// поэтому масштабируется вместе с картой.

const ARROW_NS = 'http://www.w3.org/2000/svg';

interface Part { text: string; color?: string; shape?: 'circle' | 'triangle'; }

/** Создать SVG-элемент внутри `parent`, размером W×H в пикселях карты. */
export function createArrowOverlay(
    parent: HTMLElement, width: number, height: number,
): SVGSVGElement {
    const svg = document.createElementNS(ARROW_NS, 'svg') as SVGSVGElement;
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    Object.assign(svg.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        pointerEvents: 'none',
        zIndex: '10',
    });
    parent.appendChild(svg);
    return svg;
}

export function clearArrows(svg: SVGSVGElement): void {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
}

/* ---------- низкоуровневые хелперы ---------- */

function lineWidth(totalLength: number): number {
    return Math.max(totalLength / 28, 2.5);
}

function dashArray(width: number): string {
    return `${width * 3} ${width * 3}`;
}

function appendLine(
    svg: SVGElement,
    fromX: number, fromY: number,
    toX: number, toY: number,
    width: number, color: string, dashed: boolean,
): void {
    const line = document.createElementNS(ARROW_NS, 'line') as SVGLineElement;
    line.setAttribute('x1', String(fromX));
    line.setAttribute('y1', String(fromY));
    line.setAttribute('x2', String(toX));
    line.setAttribute('y2', String(toY));
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', String(width));
    line.setAttribute('stroke-linecap', 'butt');
    if (dashed) line.setAttribute('stroke-dasharray', dashArray(width));
    svg.appendChild(line);
}

function appendHead(
    svg: SVGElement,
    tipX: number, tipY: number,
    dirX: number, dirY: number,
    width: number, color: string,
): void {
    const nx = dirY, ny = -dirX;
    const headLength = Math.max(width * 3.2, 10);
    const headWidth = width * 2.8;
    const baseX = tipX - dirX * headLength;
    const baseY = tipY - dirY * headLength;
    const head = document.createElementNS(ARROW_NS, 'polygon') as SVGPolygonElement;
    head.setAttribute('points',
        `${tipX},${tipY} ` +
        `${baseX + nx * headWidth / 2},${baseY + ny * headWidth / 2} ` +
        `${baseX - nx * headWidth / 2},${baseY - ny * headWidth / 2}`);
    head.setAttribute('fill', color);
    svg.appendChild(head);
}

function appendLabelAt(
    svg: SVGSVGElement,
    midX: number, midY: number,
    normalX: number, normalY: number,
    dirX: number, dirY: number,
    value1: number, value2: number,
    color: string, w: number,
): void {
    const hasFirst = value1 !== 0;
    const hasSecond = value2 !== 0;
    if (!hasFirst && !hasSecond) return;

    const fontSize = 14;
    const TRIANGLE_SCALE = 2.2;
    const CIRCLE_SCALE = TRIANGLE_SCALE * 1.27;
    const circleFontSize = fontSize * CIRCLE_SCALE;
    const triangleFontSize = fontSize * TRIANGLE_SCALE;
    const lineHeight = Math.max(circleFontSize, triangleFontSize) * 1.05;
    const gap = 10;
    const circleNudge = -circleFontSize * 0.06;

    const singleParts: Part[] = [];
    if (hasFirst) {
        singleParts.push({ text: '●', color, shape: 'circle' });
        singleParts.push({ text: ` ${value1}` });
    }
    if (hasFirst && hasSecond) singleParts.push({ text: ' / ' });
    if (hasSecond) {
        singleParts.push({ text: '▲', color, shape: 'triangle' });
        singleParts.push({ text: ` ${value2}` });
    }

    const singleLineText = singleParts.map(p => p.text).join('');
    const estSingleWidth = singleLineText.length * fontSize * 0.55;
    const mostlyHorizontal = Math.abs(dirX) > 0.8;
    const useTwoLines = !mostlyHorizontal && estSingleWidth > 90 && hasFirst && hasSecond;

    const lines: Part[][] = useTwoLines
        ? [
            [{ text: '●', color, shape: 'circle' }, { text: ` ${value1} /` }],
            [{ text: '▲', color, shape: 'triangle' }, { text: ` ${value2}` }],
          ]
        : [singleParts];

    const text = document.createElementNS(ARROW_NS, 'text') as SVGTextElement;
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('font-family', 'sans-serif');
    text.setAttribute('font-size', String(fontSize));
    text.setAttribute('fill', '#222');

    const renderAt = (atX: number, atY: number) => {
        while (text.firstChild) text.removeChild(text.firstChild);
        const n = lines.length;
        lines.forEach((parts, i) => {
            const tspan = document.createElementNS(ARROW_NS, 'tspan') as SVGTSpanElement;
            tspan.setAttribute('x', String(atX));
            tspan.setAttribute('y', String(atY + (i - (n - 1) / 2) * lineHeight));
            let pendingDy = 0;
            for (const p of parts) {
                const sub = document.createElementNS(ARROW_NS, 'tspan') as SVGTSpanElement;
                sub.textContent = p.text;
                if (p.color) sub.setAttribute('fill', p.color);
                if (p.shape === 'circle') {
                    sub.setAttribute('font-size', String(circleFontSize));
                    sub.setAttribute('dominant-baseline', 'central');
                    sub.setAttribute('dy', String(circleNudge));
                    pendingDy = -circleNudge;
                } else if (p.shape === 'triangle') {
                    sub.setAttribute('font-size', String(triangleFontSize));
                    sub.setAttribute('dominant-baseline', 'central');
                    if (pendingDy) { sub.setAttribute('dy', String(pendingDy)); pendingDy = 0; }
                } else if (pendingDy) {
                    sub.setAttribute('dy', String(pendingDy));
                    pendingDy = 0;
                }
                tspan.appendChild(sub);
            }
            text.appendChild(tspan);
        });
    };

    renderAt(midX, midY);
    svg.appendChild(text);
    const bbox = text.getBBox();
    const W = bbox.width, H = bbox.height;
    const offset = w / 2 + gap + Math.abs(normalX) * W / 2 + Math.abs(normalY) * H / 2;
    renderAt(midX + normalX * offset, midY + normalY * offset);
}

function appendLabel(
    svg: SVGSVGElement,
    afx: number, afy: number,
    atx: number, aty: number,
    value1: number, value2: number,
    color: string, w: number,
    flipNormal: boolean = false,
): void {
    const ax = atx - afx, ay = aty - afy;
    const aLen = Math.hypot(ax, ay);
    if (aLen < 1e-6) return;
    const ux = ax / aLen, uy = ay / aLen;
    let nx = uy, ny = -ux;
    if (flipNormal) { nx = -nx; ny = -ny; }
    appendLabelAt(svg, (afx + atx) / 2, (afy + aty) / 2, nx, ny, ux, uy, value1, value2, color, w);
}

/* ---------- публичные методы ---------- */

export function drawArrow(
    svg: SVGSVGElement,
    fromX: number, fromY: number,
    toX: number, toY: number,
    value1: number = 0,
    value2: number = 0,
    color: string = '#e11d48',
    trim: number = 0.1,
): void {
    const dx = toX - fromX, dy = toY - fromY;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) return;
    const ux = dx / length, uy = dy / length;

    const t = Math.max(0, Math.min(0.49, trim));
    const sX = fromX + ux * length * t;
    const sY = fromY + uy * length * t;
    const eX = toX - ux * length * t;
    const eY = toY - uy * length * t;
    const drawn = length * (1 - 2 * t);
    if (drawn < 1e-6) return;

    const width = lineWidth(length);
    const headLength = Math.max(width * 3.2, 10);
    const bodyEndX = eX - ux * headLength;
    const bodyEndY = eY - uy * headLength;

    appendLine(svg, sX, sY, bodyEndX, bodyEndY, width, color, false);
    appendHead(svg, eX, eY, ux, uy, width, color);
    appendLabel(svg, fromX, fromY, toX, toY, value1, value2, color, width);
}

export function drawSupportDefense(
    svg: SVGSVGElement,
    fromX: number, fromY: number,
    toX: number, toY: number,
    value1: number = 0,
    value2: number = 0,
    color: string = '#e11d48',
    trim: number = 0.1,
): void {
    const dx = toX - fromX, dy = toY - fromY;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) return;
    const ux = dx / length, uy = dy / length;

    const t = Math.max(0, Math.min(0.49, trim));
    const sX = fromX + ux * length * t;
    const sY = fromY + uy * length * t;
    const eX = toX - ux * length * t;
    const eY = toY - uy * length * t;
    if (Math.hypot(eX - sX, eY - sY) < 1e-6) return;

    const width = lineWidth(length);
    appendLine(svg, sX, sY, eX, eY, width, color, true);
    appendLabel(svg, fromX, fromY, toX, toY, value1, value2, color, width);
}

export function drawSupportAttack(
    svg: SVGSVGElement,
    ax: number, ay: number,
    bx: number, by: number,
    cx: number, cy: number,
    value1: number = 0,
    value2: number = 0,
    color: string = '#e11d48',
    bend: number = 0,
    pull: number = 0.6,
    endT: number = 0.9,
): void {
    const dxBC = cx - bx, dyBC = cy - by;
    const lenBC = Math.hypot(dxBC, dyBC);
    if (lenBC < 1e-6) return;
    const uxBC = dxBC / lenBC, uyBC = dyBC / lenBC;
    const pxBC = -uyBC, pyBC = uxBC;

    const sideA = pxBC * (ax - bx) + pyBC * (ay - by);
    const sideSign = sideA >= 0 ? 1 : -1;
    const perpOff = lenBC * bend * sideSign;

    const p0x = ax, p0y = ay;
    const p1x = ax + pull * (bx - ax) + pxBC * perpOff;
    const p1y = ay + pull * (by - ay) + pyBC * perpOff;
    const p2x = cx + pull * (bx - cx) + pxBC * perpOff;
    const p2y = cy + pull * (by - cy) + pyBC * perpOff;
    const p3x = cx, p3y = cy;

    const w = lineWidth(Math.hypot(cx - ax, cy - ay));

    const t = Math.max(0, Math.min(1, endT));
    const q1x = p0x + t * (p1x - p0x), q1y = p0y + t * (p1y - p0y);
    const q2x = p1x + t * (p2x - p1x), q2y = p1y + t * (p2y - p1y);
    const q3x = p2x + t * (p3x - p2x), q3y = p2y + t * (p3y - p2y);
    const r0x = q1x + t * (q2x - q1x), r0y = q1y + t * (q2y - q1y);
    const r1x = q2x + t * (q3x - q2x), r1y = q2y + t * (q3y - q2y);
    const sx = r0x + t * (r1x - r0x), sy = r0y + t * (r1y - r0y);

    const path = document.createElementNS(ARROW_NS, 'path') as SVGPathElement;
    path.setAttribute('d',
        `M ${p0x} ${p0y} C ${q1x} ${q1y}, ${r0x} ${r0y}, ${sx} ${sy}`);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', String(w));
    path.setAttribute('stroke-dasharray', dashArray(w));
    path.setAttribute('stroke-linecap', 'butt');
    svg.appendChild(path);

    if (Math.hypot(cx - ax, cy - ay) < 1e-6) return;

    const mX = (p0x + 3 * p1x + 3 * p2x + p3x) / 8;
    const mY = (p0y + 3 * p1y + 3 * p2y + p3y) / 8;
    const tX = 0.75 * (p1x - p0x) + 1.5 * (p2x - p1x) + 0.75 * (p3x - p2x);
    const tY = 0.75 * (p1y - p0y) + 1.5 * (p2y - p1y) + 0.75 * (p3y - p2y);
    const tLen = Math.hypot(tX, tY);
    if (tLen < 1e-6) return;
    const dirX = tX / tLen, dirY = tY / tLen;

    let normalX = dirY, normalY = -dirX;
    if (normalX * (bx - mX) + normalY * (by - mY) > 0) {
        normalX = -normalX; normalY = -normalY;
    }

    appendLabelAt(svg, mX, mY, normalX, normalY, dirX, dirY, value1, value2, color, w);
}
/**
 * Пунктирная стрелка отступления (Order 5). Тоньше обычных стрелок,
 * заметно обрезана с обоих концов и полупрозрачна — на карте должно
 * читаться как «служебная разметка», а не как боевой приказ.
 */
export function drawRetreat(
    svg: SVGSVGElement,
    fromX: number, fromY: number,
    toX: number, toY: number,
    color: string = '#e11d48',
    trim: number = 0.2,
): void {
    const dx = toX - fromX, dy = toY - fromY;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) return;
    const ux = dx / length, uy = dy / length;

    const t = Math.max(0, Math.min(0.49, trim));
    const sX = fromX + ux * length * t;
    const sY = fromY + uy * length * t;
    const eX = toX - ux * length * t;
    const eY = toY - uy * length * t;

    const width = Math.max(lineWidth(length) * 0.55, 2);
    const headLength = Math.max(width * 3.2, 9);
    const bodyEndX = eX - ux * headLength;
    const bodyEndY = eY - uy * headLength;

    const g = document.createElementNS(ARROW_NS, 'g') as SVGGElement;
    g.setAttribute('opacity', '0.45');
    appendLine(g, sX, sY, bodyEndX, bodyEndY, width, color, true);
    appendHead(g, eX, eY, ux, uy, width, color);
    svg.appendChild(g);
}