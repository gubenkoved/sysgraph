import { EVT_D3_PARAMS_CHANGED, EVT_GRAPH_UPDATED, EVT_RENDER_MODE_CHANGED } from './constants.js';
import { emit, on } from './event-bus.js';
import { ForceGraphInstance } from './graph-ui.js';
import { settings } from './settings.js';
import { getPhysicsOverride, setPhysicsOverride, state } from './state.js';

// ── physics toggle ──────────────────────────────────────────
// Toolbar button that pauses/resumes the force simulation. Clicking applies a
// transient, runtime-only override (`state.physicsOverride`) of physics
// enablement — it never mutates the persisted `settings.d3EnablePhysics`, so a
// pause never leaks into the exported/shared display block. The override is
// cleared on graph load and when the settings-pane toggle is changed.
// While the engine is actively ticking a subtle pulsing dot appears on the
// button. Works in both 2D and 3D since both renderers expose
// onEngineTick/onEngineStop.

const wrapEl = document.querySelector('.physics-toggle-wrap') as HTMLElement;
const toggleBtn = document.getElementById('physicsToggle') as HTMLElement;
const iconEl = document.getElementById('physicsToggleIcon') as HTMLElement;

// whether the engine is currently churning (between tick and stop)
let running = false;

// the override wins over the persisted setting (null = follow the setting)
function physicsEnabled(): boolean {
    return getPhysicsOverride() ?? settings.d3EnablePhysics;
}

function render(): void {
    const enabled = physicsEnabled();
    // "active" = physics is enabled AND the engine is still churning. Once the
    // simulation settles we revert to the play affordance so a single click
    // reheats it (rather than first pausing an already-idle engine)
    const active = enabled && running;
    iconEl.textContent = active ? 'motion_photos_paused' : 'motion_blur';
    toggleBtn.title = active
        ? 'Physics running — click to pause'
        : 'Physics paused — click to start';
    // subtle pulsing dot only while the engine is actively simulating
    wrapEl.classList.toggle('physics-active', active);
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

    // a graph load clears the override, so re-sync the icon to the new graph's
    // persisted setting
    on(EVT_GRAPH_UPDATED, () => render());

    toggleBtn.addEventListener('click', () => {
        const enabled = state.physicsOverride ?? settings.d3EnablePhysics;
        if (enabled && running) {
            // actively simulating → pause via a transient override, leaving the
            // persisted setting (and any exported display block) untouched
            setPhysicsOverride(false);
        } else if (!enabled) {
            // paused → resume via the transient override
            setPhysicsOverride(true);
        }
        // when enabled but already settled we leave the override untouched and
        // just let applyD3Params (wired to this event) reheat the engine
        emit(EVT_D3_PARAMS_CHANGED, null);
    });
}
