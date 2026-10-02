import { EVT_RENDER_MODE_CHANGED } from './constants.js';
import { on } from './event-bus.js';
import { GraphViewInstance } from './graph-ui.js';
import { is3D } from './render-mode.js';

// ── zoom indicator ──────────────────────────────────────────
// Floating bottom-left widget: [ - ]  100%  [ + ]
// Tracks effective camera magnification in both 2D and 3D.

const ZOOM_STEP = 1.5;       // multiply / divide by this on each click
const ZOOM_ANIM_MS = 200;    // animation duration for programmatic zoom
const compactPercent = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

const zoomLevelEl = document.getElementById('zoomLevel') as HTMLElement;
const zoomInBtn   = document.getElementById('zoomIn')    as HTMLElement;
const zoomOutBtn  = document.getElementById('zoomOut')   as HTMLElement;

function updateZoomLabel(k: number): void {
    const percent = Math.round(k * 100);
    zoomLevelEl.textContent = `${is3D() && percent >= 10_000 ? compactPercent.format(percent) : percent}%`;
}

// The graph view persists across mode changes, but its zoom meaning changes.
// Refresh the label immediately after each switch instead of waiting for input.
function attachZoomTracking(): void {
    GraphViewInstance.onZoom(({ k }: { k: number }) => updateZoomLabel(k));
    updateZoomLabel(GraphViewInstance.zoom());
}

export function initZoomIndicator(): void {
    attachZoomTracking();

    // Refresh the control after a render-mode switch.
    on(EVT_RENDER_MODE_CHANGED, () => attachZoomTracking());

    zoomInBtn.addEventListener('click', () => {
        GraphViewInstance.zoom(GraphViewInstance.zoom() * ZOOM_STEP, ZOOM_ANIM_MS);
    });

    zoomOutBtn.addEventListener('click', () => {
        GraphViewInstance.zoom(GraphViewInstance.zoom() / ZOOM_STEP, ZOOM_ANIM_MS);
    });

    zoomLevelEl.addEventListener('click', () => {
        GraphViewInstance.zoom(1, ZOOM_ANIM_MS);
    });
}
