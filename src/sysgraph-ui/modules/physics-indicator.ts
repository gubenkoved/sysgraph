import { EVT_GPU_PARAMS_CHANGED, EVT_GRAPH_UPDATED } from './constants.js';
import { emit, on } from './event-bus.js';
import { GraphViewInstance } from './graph-ui.js';
import { settings } from './settings.js';
import { getPhysicsOverride, setPhysicsOverride, state } from './state.js';

// ── physics toggle ──────────────────────────────────────────
// Toolbar button that pauses/resumes the force simulation. Clicking applies a
// transient, runtime-only override (`state.physicsOverride`) of physics
// enablement — it never mutates the persisted `settings.gpuEnablePhysics`, so a
// pause never leaks into the exported/shared display block. The override is
// cleared on graph load and when the settings-pane toggle is changed.
// While the engine is actively ticking a subtle pulsing dot appears on the
// button in either camera mode.

const wrapEl = document.querySelector('.physics-toggle-wrap') as HTMLElement;
const toggleBtn = document.getElementById('physicsToggle') as HTMLElement;
const iconEl = document.getElementById('physicsToggleIcon') as HTMLElement;
const fastForwardBtn = document.getElementById('physicsFastForward') as HTMLElement;

// whether the engine is currently churning (between tick and stop)
let running = false;

// the override wins over the persisted setting (null = follow the setting)
function physicsEnabled(): boolean {
    return settings.layoutMode === 'force' && (getPhysicsOverride() ?? settings.gpuEnablePhysics);
}

function render(): void {
    const enabled = physicsEnabled();
    const available = settings.layoutMode === 'force';
    toggleBtn.toggleAttribute('disabled', !available);
    fastForwardBtn.toggleAttribute('disabled', !available);
    // "active" means the GPU layout is currently ticking.
    const active = enabled && running;
    iconEl.textContent = active ? 'motion_photos_paused' : 'motion_blur';
    toggleBtn.title = !available ? 'Physics is available in GPU force layout'
        : active ? 'Physics running — click to pause' : 'Physics paused — click to start';
    // subtle pulsing dot only while the engine is actively simulating
    wrapEl.classList.toggle('physics-active', active);
    const fast = enabled && GraphViewInstance.isFastForward();
    fastForwardBtn.classList.toggle('active', fast);
    fastForwardBtn.setAttribute('aria-pressed', String(fast));
    const fastLabel = fast
        ? 'Fast forwarding physics — click for normal speed'
        : 'Fast forward physics — run extra force ticks per frame';
    fastForwardBtn.title = fastLabel;
    fastForwardBtn.setAttribute('aria-label', fastLabel);
}

// Observe the shared WebGPU graph view's layout ticks.
function attachEngineTracking(): void {
    running = false;
    GraphViewInstance.onEngineTick(() => {
        if (!running) {
            running = true;
            render();
        }
    });
    GraphViewInstance.onEngineStop(() => {
        running = false;
        render();
    });
}

export function initPhysicsIndicator(): void {
    attachEngineTracking();
    render();

    // keep the icon in sync when physics is toggled elsewhere (settings pane)
    on(EVT_GPU_PARAMS_CHANGED, () => {
        if (!physicsEnabled()) GraphViewInstance.setFastForward(false);
        render();
    });

    // a graph load clears the override, so re-sync the icon to the new graph's
    // persisted setting
    on(EVT_GRAPH_UPDATED, () => { GraphViewInstance.setFastForward(false); render(); });

    toggleBtn.addEventListener('click', () => {
        if (settings.layoutMode !== 'force') return;
        const enabled = state.physicsOverride ?? settings.gpuEnablePhysics;
        if (enabled) {
            // Pause via a transient override, leaving the persisted setting
            // (and any exported display block) untouched.
            GraphViewInstance.setFastForward(false);
            setPhysicsOverride(false);
        } else {
            // paused → resume via the transient override
            setPhysicsOverride(true);
        }
        // Reapply the current layout setting after changing the override.
        emit(EVT_GPU_PARAMS_CHANGED, null);
    });

    fastForwardBtn.addEventListener('click', () => {
        if (settings.layoutMode !== 'force') return;
        const next = !GraphViewInstance.isFastForward();
        GraphViewInstance.setFastForward(next);
        if (next && !physicsEnabled()) {
            setPhysicsOverride(true);
            emit(EVT_GPU_PARAMS_CHANGED, null);
        }
        render();
    });
}
