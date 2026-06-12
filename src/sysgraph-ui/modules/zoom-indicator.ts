import { EVT_RENDER_MODE_CHANGED } from './constants.js';
import { on } from './event-bus.js';
import { ForceGraphInstance } from './graph-ui.js';
import { is3D } from './render-mode.js';

// ── zoom indicator ──────────────────────────────────────────
// Floating bottom-left widget: [ - ]  100%  [ + ]
// Tracks the live force-graph zoom level and exposes +/- buttons that
// programmatically animate the camera. 2D only — hidden in 3D mode (the 3D
// renderer has no equivalent zoom API).

const ZOOM_STEP = 1.5;       // multiply / divide by this on each click
const ZOOM_ANIM_MS = 200;    // animation duration for programmatic zoom

const zoomLevelEl = document.getElementById('zoomLevel') as HTMLElement;
const zoomInBtn   = document.getElementById('zoomIn')    as HTMLElement;
const zoomOutBtn  = document.getElementById('zoomOut')   as HTMLElement;

let currentZoom = 1;

function updateZoomLabel(k: number): void {
    currentZoom = k;
    zoomLevelEl.textContent = `${Math.round(k * 100)}%`;
}

// attach the live zoom listener to the active 2D renderer; no-op in 3D
function attachZoomTracking(): void {
    if (is3D()) return;
    ForceGraphInstance.onZoom(({ k }: { k: number }) => updateZoomLabel(k));
}

export function initZoomIndicator(): void {
    attachZoomTracking();

    // re-attach to the freshly built 2D renderer after a mode switch back to 2D
    on(EVT_RENDER_MODE_CHANGED, () => attachZoomTracking());

    zoomInBtn.addEventListener('click', () => {
        if (is3D()) return;
        ForceGraphInstance.zoom(currentZoom * ZOOM_STEP, ZOOM_ANIM_MS);
    });

    zoomOutBtn.addEventListener('click', () => {
        if (is3D()) return;
        ForceGraphInstance.zoom(currentZoom / ZOOM_STEP, ZOOM_ANIM_MS);
    });

    zoomLevelEl.addEventListener('click', () => {
        if (is3D()) return;
        ForceGraphInstance.zoom(1, ZOOM_ANIM_MS);
    });
}
