import * as d3 from "https://cdn.jsdelivr.net/npm/d3@6/+esm";

export function colorWithAlpha(color, alpha) {
    const col = d3.color(color);
    col.opacity = alpha;
    return col.toString();
}

export function colorAdjustAlpha(color, factor) {
    const col = d3.color(color);
    col.opacity *= factor;
    return col.toString();
}

export function darkerColor(color) {
    return d3.color(color).darker();
}

export function drawCircle(ctx, x, y, r, strokeWidth, strokeStyle) {
    ctx.save();
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = strokeStyle;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI, false);
    ctx.stroke();
    ctx.restore();
}

export function fnv1a(str) {
    let hash = 0x811c9dc5;

    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }

    return hash >>> 0; // unsigned
}
