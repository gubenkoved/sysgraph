import { EVT_D3_PARAMS_CHANGED, EVT_RENDER_MODE_CHANGED } from './constants.js';
import { emit, on } from './event-bus.js';
import { ForceGraphInstance } from './graph-ui.js';
import { settings } from './settings.js';
import { syncSettingsPane } from './settings-pane.js';

// ---------------------------------------------------------------------------
// Physics Indicator
// ---------------------------------------------------------------------------
// Floating top-right widget that doubles as a play/pause toggle for the force
// simulation. While the engine is actively ticking the icon becomes a spinning
// "motion" glyph (the demanding state); clicking flips the existing
// `settings.d3EnablePhysics` flag — applyD3Params then freezes (cooldownTicks(0))
// or reheats accordingly. Works in both 2D and 3D since both renderers expose
// onEngineTick/onEngineStop.

const indicatorEl = document.getElementById('physics-indicator') as HTMLElement;
const toggleBtn = document.getElementById('physicsToggle') as HTMLElement;
const iconEl = document.getElementById('physicsToggleIcon') as HTMLElement;

// whether the engine is currently churning (between tick and stop)
let running = false;

function render(): void {
    const enabled = settings.d3EnablePhysics;
    const active = enabled && running;
    // while actively simulating, the icon becomes an animated "motion" glyph;
    // otherwise it's the static play/pause toggle affordance
    iconEl.textContent = active ? 'blur_on' : enabled ? 'pause' : 'play_arrow';
    toggleBtn.title = enabled
        ? 'Physics running — click to pause'
        : 'Physics paused — click to resume';
    indicatorEl.classList.toggle('is-running', active);
}

// (re)attach engine lifecycle callbacks to the active renderer; reset the
// running state since the freshly built instance hasn't ticked yet
function attachEngineTracking(): void {
    running = false;
    ForceGraphInstance.onEngineTick(() => {
        if (!running) {
            running = true;
            render();
        }
    });
    ForceGraphInstance.onEngineStop(() => {
        running = false;
        render();
    });
}

export function initPhysicsIndicator(): void {
    attachEngineTracking();
    render();

    // re-attach to the freshly built renderer after a render-mode swap
    on(EVT_RENDER_MODE_CHANGED, () => {
        attachEngineTracking();
        render();
    });

    // keep the icon in sync when physics is toggled elsewhere (settings pane)
    on(EVT_D3_PARAMS_CHANGED, () => render());

    toggleBtn.addEventListener('click', () => {
        settings.d3EnablePhysics = !settings.d3EnablePhysics;
        // applyD3Params (wired to this event) freezes or reheats the engine
        emit(EVT_D3_PARAMS_CHANGED, null);
        // reflect the new flag in the settings pane checkbox
        syncSettingsPane();
    });
}
