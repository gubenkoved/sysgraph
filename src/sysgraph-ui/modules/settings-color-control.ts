import type { RgbaColor } from './settings.js';

interface HsvColor {
    h: number;
    s: number;
    v: number;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export function rgbToHsv({ r, g, b }: RgbaColor): HsvColor {
    const red = r / 255;
    const green = g / 255;
    const blue = b / 255;
    const high = Math.max(red, green, blue);
    const low = Math.min(red, green, blue);
    const difference = high - low;
    let h = 0;
    if (difference !== 0) {
        if (high === red) h = ((green - blue) / difference) % 6;
        else if (high === green) h = (blue - red) / difference + 2;
        else h = (red - green) / difference + 4;
        h = (h * 60 + 360) % 360;
    }
    return { h, s: high === 0 ? 0 : difference / high, v: high };
}

export function hsvToRgb({ h, s, v }: HsvColor): Pick<RgbaColor, 'r' | 'g' | 'b'> {
    const chroma = v * s;
    const sector = ((h % 360) + 360) % 360 / 60;
    const intermediate = chroma * (1 - Math.abs(sector % 2 - 1));
    const offset = v - chroma;
    const channels = sector < 1 ? [chroma, intermediate, 0]
        : sector < 2 ? [intermediate, chroma, 0]
        : sector < 3 ? [0, chroma, intermediate]
        : sector < 4 ? [0, intermediate, chroma]
        : sector < 5 ? [intermediate, 0, chroma]
        : [chroma, 0, intermediate];
    return {
        r: Math.round((channels[0]! + offset) * 255),
        g: Math.round((channels[1]! + offset) * 255),
        b: Math.round((channels[2]! + offset) * 255),
    };
}

function toHex({ r, g, b }: RgbaColor): string {
    return `#${[r, g, b].map(channel =>
        clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

export function parseHex(value: string): Pick<RgbaColor, 'r' | 'g' | 'b'> | null {
    const raw = value.trim().replace(/^#/, '');
    if (!/^(?:[\da-f]{3}|[\da-f]{6})$/i.test(raw)) return null;
    const hex = raw.length === 3 ? [...raw].map(channel => channel + channel).join('') : raw;
    return {
        r: Number.parseInt(hex.slice(0, 2), 16),
        g: Number.parseInt(hex.slice(2, 4), 16),
        b: Number.parseInt(hex.slice(4, 6), 16),
    };
}

let nextId = 0;
let openControl: { editor: HTMLElement; row: HTMLButtonElement; item: HTMLElement } | null = null;

function closeOpenControl(): void {
    if (!openControl) return;
    openControl.editor.hidden = true;
    openControl.row.setAttribute('aria-expanded', 'false');
    openControl.item.classList.remove('sg-color-open');
    openControl = null;
}

export function createColorControl(
    name: string, getColor: () => RgbaColor, onChange: () => void,
): { element: HTMLElement; sync(): void } {
    const item = document.createElement('div');
    item.className = 'sg-color-item';
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'sg-color-row';
    row.setAttribute('aria-label', `Edit ${name} color`);
    row.setAttribute('aria-expanded', 'false');
    const editor = document.createElement('div');
    editor.id = `sg-color-editor-${++nextId}`;
    editor.className = 'sg-color-editor';
    editor.hidden = true;
    row.setAttribute('aria-controls', editor.id);
    const title = document.createElement('span');
    title.className = 'sg-color-name';
    title.textContent = name;
    const value = document.createElement('span');
    value.className = 'sg-color-value';
    const swatch = document.createElement('span');
    swatch.className = 'sg-color-swatch';
    const swatchFill = document.createElement('span');
    swatchFill.className = 'sg-color-swatch-fill';
    swatch.appendChild(swatchFill);
    row.append(title, value, swatch);
    item.append(row, editor);

    const field = document.createElement('div');
    field.className = 'sg-color-field';
    field.tabIndex = 0;
    field.setAttribute('role', 'slider');
    field.setAttribute('aria-label', `${name} saturation and brightness`);
    field.setAttribute('aria-valuemin', '0');
    field.setAttribute('aria-valuemax', '100');
    const cursor = document.createElement('span');
    cursor.className = 'sg-color-field-cursor';
    field.appendChild(cursor);
    editor.appendChild(field);

    const sliders = document.createElement('div');
    sliders.className = 'sg-color-sliders';
    const hueLabel = document.createElement('label');
    hueLabel.textContent = 'Hue';
    const hue = document.createElement('input');
    hue.type = 'range';
    hue.min = '0';
    hue.max = '360';
    hue.step = '1';
    hue.className = 'sg-color-hue';
    hueLabel.appendChild(hue);
    const alphaLabel = document.createElement('label');
    alphaLabel.textContent = 'Opacity';
    const alpha = document.createElement('input');
    alpha.type = 'range';
    alpha.min = '0';
    alpha.max = '100';
    alpha.step = '1';
    alpha.className = 'sg-color-alpha';
    alphaLabel.appendChild(alpha);
    sliders.append(hueLabel, alphaLabel);
    editor.appendChild(sliders);

    const inputs = document.createElement('div');
    inputs.className = 'sg-color-inputs';
    const hexLabel = document.createElement('label');
    hexLabel.textContent = 'Hex';
    const hex = document.createElement('input');
    hex.type = 'text';
    hex.maxLength = 7;
    hex.spellcheck = false;
    hex.setAttribute('autocomplete', 'off');
    hexLabel.appendChild(hex);
    const opacityLabel = document.createElement('label');
    opacityLabel.textContent = 'Opacity %';
    const opacity = document.createElement('input');
    opacity.type = 'number';
    opacity.min = '0';
    opacity.max = '100';
    opacity.step = '1';
    opacityLabel.appendChild(opacity);
    inputs.append(hexLabel, opacityLabel);
    editor.appendChild(inputs);

    let hsv = rgbToHsv(getColor());
    const render = (): void => {
        const color = getColor();
        const hexValue = toHex(color);
        const percent = Math.round(clamp(color.a, 0, 1) * 100);
        value.textContent = `${hexValue} · ${percent}%`;
        row.setAttribute('aria-label', `Edit ${name} color, ${hexValue}, ${percent}% opacity`);
        swatchFill.style.backgroundColor = `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`;
        field.style.setProperty('--sg-picker-hue', `hsl(${hsv.h} 100% 50%)`);
        cursor.style.left = `clamp(7px, ${hsv.s * 100}%, calc(100% - 7px))`;
        cursor.style.top = `clamp(7px, ${(1 - hsv.v) * 100}%, calc(100% - 7px))`;
        field.setAttribute('aria-valuenow', String(Math.round(hsv.s * 100)));
        field.setAttribute('aria-valuetext', `Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`);
        hue.value = String(Math.round(hsv.h));
        alpha.value = String(percent);
        alpha.style.setProperty('--sg-opacity-color', hexValue);
        hex.value = hexValue;
        opacity.value = String(percent);
    };
    const updateRgb = (): void => {
        Object.assign(getColor(), hsvToRgb(hsv));
        render();
        onChange();
    };
    const updateAlpha = (percent: number): void => {
        getColor().a = clamp(percent, 0, 100) / 100;
        render();
        onChange();
    };
    const updateField = (event: PointerEvent): void => {
        const bounds = field.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        hsv.s = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
        hsv.v = 1 - clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
        updateRgb();
    };
    let dragging = false;
    field.addEventListener('pointerdown', event => {
        dragging = true;
        field.setPointerCapture(event.pointerId);
        updateField(event);
    });
    field.addEventListener('pointermove', event => { if (dragging) updateField(event); });
    field.addEventListener('pointerup', () => { dragging = false; });
    field.addEventListener('pointercancel', () => { dragging = false; });
    field.addEventListener('keydown', event => {
        if (event.key === 'ArrowLeft') hsv.s = clamp(hsv.s - 0.01, 0, 1);
        else if (event.key === 'ArrowRight') hsv.s = clamp(hsv.s + 0.01, 0, 1);
        else if (event.key === 'ArrowDown') hsv.v = clamp(hsv.v - 0.01, 0, 1);
        else if (event.key === 'ArrowUp') hsv.v = clamp(hsv.v + 0.01, 0, 1);
        else return;
        event.preventDefault();
        updateRgb();
    });
    hue.addEventListener('input', () => { hsv.h = Number(hue.value); updateRgb(); });
    alpha.addEventListener('input', () => updateAlpha(Number(alpha.value)));
    hex.addEventListener('change', () => {
        const parsed = parseHex(hex.value);
        if (!parsed) { render(); return; }
        Object.assign(getColor(), parsed);
        hsv = rgbToHsv(getColor());
        render();
        onChange();
    });
    opacity.addEventListener('change', () => {
        const percent = Number(opacity.value);
        if (!opacity.value.trim() || !Number.isFinite(percent)) { render(); return; }
        updateAlpha(percent);
    });
    row.addEventListener('click', () => {
        const opening = editor.hidden;
        closeOpenControl();
        if (opening) {
            editor.hidden = false;
            row.setAttribute('aria-expanded', 'true');
            item.classList.add('sg-color-open');
            openControl = { editor, row, item };
        }
    });
    editor.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        closeOpenControl();
        row.focus();
    });
    render();
    return {
        element: item,
        sync: () => { hsv = rgbToHsv(getColor()); render(); },
    };
}
