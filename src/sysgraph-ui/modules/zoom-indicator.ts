import { ForceGraphInstance } from './graph-ui.js';

// ---------------------------------------------------------------------------
// Zoom Indicator
// ---------------------------------------------------------------------------
// Floating bottom-left widget: [ - ]  100%  [ + ]
// Tracks the live force-graph zoom level and exposes +/- buttons that
// programmatically animate the camera.

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

export function initZoomIndicator(): void {
    // Track live zoom from the graph (fires on user scroll/pinch and programmatic calls)
    ForceGraphInstance.onZoom(({ k }: { k: number }) => updateZoomLabel(k));

    zoomInBtn.addEventListener('click', () => {
        ForceGraphInstance.zoom(currentZoom * ZOOM_STEP, ZOOM_ANIM_MS);
    });

    zoomOutBtn.addEventListener('click', () => {
        ForceGraphInstance.zoom(currentZoom / ZOOM_STEP, ZOOM_ANIM_MS);
    });

    zoomLevelEl.addEventListener('click', () => {
        ForceGraphInstance.zoom(1, ZOOM_ANIM_MS);
    });
}
