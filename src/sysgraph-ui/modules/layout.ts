import {
    type CreateComponentOptions,
    createDockview,
    type DockviewApi,
    type DockviewComponentOptions,
    type GroupPanelPartInitParameters,
    type IContentRenderer,
    type IDockviewPanel,
    type ITabRenderer,
    type SerializedDockview,
    type TabPartInitParameters,
    themeDark,
    themeLight,
} from 'dockview-core';
import { EVT_LAYOUT_CHANGED, EVT_THEME_CHANGED, PANEL_GRAPH } from './constants.js';
import { emit, on } from './event-bus.js';
import { getTheme } from './theme.js';

// dockview docks the panels (drag, tabs, resize, split) so they share the
// screen with the graph instead of floating over it. The graph lives in a
// locked, header-less center group; every other panel docks around it.

type DockDirection = 'left' | 'right' | 'above' | 'below' | 'within';

export interface PanelSpec {
    /** unique dock panel id (also the registry key) */
    id: string;
    /** registered component name driving the renderer */
    component: string;
    /** tab title */
    title: string;
    /** persistent content element mounted into the panel */
    element: HTMLElement;
    /**
     * transient panels (e.g. per-selection details) hold content that cannot
     * be regenerated on reload, so they are not restored from a saved layout
     */
    transient?: boolean;
    /**
     * optional guard consulted when restoring a saved layout; if it returns
     * false the panel is dropped instead of restored (e.g. a panel that only
     * makes sense while a specific app mode/tool is active)
     */
    restoreGuard?: () => boolean;
    /** preferred placement when no sibling side panel is open yet */
    position?: { referencePanel?: string; direction?: DockDirection };
    /** invoked whenever the panel becomes present (open or restore) */
    onOpen?: () => void;
    /** invoked when the panel is removed (tab close) */
    onClose?: () => void;
    /**
     * optional compact icon shown inside this panel's tab, left of the title
     * (e.g. the details pin hint); the title string is a native tooltip
     */
    tabIcon?: { name: string; title: string };
}

const MOBILE_BREAKPOINT = 600;
const STORAGE_KEY = 'sysgraph:layout';
// remembers where identity-bearing panels last lived, so reopening (or a reload)
// puts them back in the same spot rather than at a recomputed default
const PLACEMENTS_KEY = 'sysgraph:panel-placements';
// default size (px) of a side panel region when first opened next to the graph
const DEFAULT_SIDE_PANEL_PX = 300;

// last-known placement of a registered panel, captured while it was open
interface PanelPlacement {
    // other panel ids that shared its group, so it can rejoin them as a tab
    groupSiblings: string[];
    // region direction relative to the graph, derived geometrically so it
    // survives the user dragging the panel around
    direction: DockDirection;
    // group size (px) along the split axis: width for left/right, height for above/below
    size?: number;
}

const registry = new Map<string, PanelSpec>();

function loadPlacements(): Record<string, PanelPlacement> {
    try {
        return JSON.parse(localStorage.getItem(PLACEMENTS_KEY) ?? '{}');
    } catch {
        return {};
    }
}

let placements: Record<string, PanelPlacement> = loadPlacements();

function savePlacements(): void {
    try {
        localStorage.setItem(PLACEMENTS_KEY, JSON.stringify(placements));
    } catch {
        // ignore — placement memory is best-effort
    }
}

// keeps persistent elements alive (in the DOM tree) while their panel is closed
const holder = document.createElement('div');
holder.id = 'dock-holder';
holder.style.display = 'none';

let api: DockviewApi | null = null;
// suppress layout persistence while we are deserializing a saved layout
let restoring = false;
// suppress re-entrancy while we are programmatically re-imposing panel sizes
let enforcing = false;
// true while a bounded animation-frame enforcement loop is in flight, so layout
// events and repeat triggers don't pile up additional loops
let enforceScheduled = false;
// number of dock groups at the last stable layout event, used to detect a
// structural change (a panel split into / removed from its own group)
let prevGroupCount = 0;
// set when a restore drops a guarded/transient panel: the remaining groups get
// re-equalized while restoring (enforcement suppressed), so we re-impose stable
// sizes on the first stable layout event after restore
let pendingEnforce = false;

function dockTheme() {
    return getTheme() === 'dark' ? themeDark : themeLight;
}

function mountElement(panelId: string, container: HTMLElement): void {
    const spec = registry.get(panelId);
    if (spec) container.appendChild(spec.element);
}

function detachElement(panelId: string): void {
    const spec = registry.get(panelId);
    if (spec?.element.parentElement) {
        holder.appendChild(spec.element);
    }
}

function createComponent(options: { id: string; name: string }): IContentRenderer {
    const wrapper = document.createElement('div');
    wrapper.className = 'dock-panel-content';
    const panelId = options.id;
    return {
        element: wrapper,
        init(_params: GroupPanelPartInitParameters): void {
            mountElement(panelId, wrapper);
        },
        dispose(): void {
            detachElement(panelId);
        },
    };
}

// custom tab name used by panels that declare a tabIcon
const TAB_WITH_ICON = 'icon-tab';

// dockview's close-button glyph (its svg helper is not exported), replicated so
// our custom tab matches the default tab exactly
function createCloseButton(): SVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('height', '11');
    svg.setAttribute('width', '11');
    svg.setAttribute('viewBox', '0 0 28 28');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.classList.add('dv-svg');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute(
        'd',
        'M2.1 27.3L0 25.2L11.55 13.65L0 2.1L2.1 0L13.65 11.55L25.2 0L27.3 2.1L15.75 13.65L27.3 25.2L25.2 27.3L13.65 15.75L2.1 27.3Z',
    );
    svg.appendChild(path);
    return svg;
}

// a default-style tab that prepends a compact icon (the panel's tabIcon) before
// the title, so an affordance like the details pin sits on its own tab instead
// of floating after every other tab in the header
function createIconTab(panelId: string): ITabRenderer {
    const spec = registry.get(panelId);
    const root = document.createElement('div');
    root.className = 'dv-default-tab';

    if (spec?.tabIcon) {
        const icon = document.createElement('md-icon');
        icon.className = 'tab-icon';
        icon.textContent = spec.tabIcon.name;
        // native tooltip keeps the hint compact and free of header clipping
        icon.title = spec.tabIcon.title;
        root.appendChild(icon);
    }

    const content = document.createElement('div');
    content.className = 'dv-default-tab-content';
    root.appendChild(content);

    const action = document.createElement('div');
    action.className = 'dv-default-tab-action';
    action.appendChild(createCloseButton());
    root.appendChild(action);

    let title = '';
    const cleanups: Array<() => void> = [];
    const render = (): void => {
        if (content.textContent !== title) content.textContent = title;
    };

    return {
        element: root,
        init(params: TabPartInitParameters): void {
            title = params.title ?? '';
            render();
            const sub = params.api.onDidTitleChange(event => {
                title = event.title;
                render();
            });
            const onPointerDown = (ev: Event): void => ev.preventDefault();
            const onClick = (ev: Event): void => {
                if (ev.defaultPrevented) return;
                ev.preventDefault();
                params.api.close();
            };
            action.addEventListener('pointerdown', onPointerDown);
            action.addEventListener('click', onClick);
            cleanups.push(() => {
                sub.dispose();
                action.removeEventListener('pointerdown', onPointerDown);
                action.removeEventListener('click', onClick);
            });
        },
        dispose(): void {
            for (const cleanup of cleanups) cleanup();
        },
    };
}

function createTabComponent(options: CreateComponentOptions): ITabRenderer | undefined {
    return options.name === TAB_WITH_ICON ? createIconTab(options.id) : undefined;
}

/** Registers a panel so it can be opened/closed and restored later. */
export function registerPanel(spec: PanelSpec): void {
    registry.set(spec.id, spec);
}

/** Removes a panel registration (used for disposable secondary panels). */
export function unregisterPanel(id: string): void {
    registry.delete(id);
}

function isMobile(): boolean {
    return window.innerWidth <= MOBILE_BREAKPOINT;
}

// id of the first docked panel that is not the graph; new side panels join its
// group as tabs so they stack instead of endlessly splitting the layout
function firstSidePanelId(): string | undefined {
    return api?.panels.find(p => p.id !== PANEL_GRAPH)?.id;
}

type ResolvedPosition = {
    referencePanel: string;
    direction: DockDirection;
    // px size for a freshly opened region next to the graph (ignored for tabs)
    size?: number;
};

function resolvePosition(spec: PanelSpec): ResolvedPosition {
    // an explicit, still-open reference wins (e.g. secondary details as a tab)
    const ref = spec.position?.referencePanel;
    if (ref && api?.getPanel(ref)) {
        return { referencePanel: ref, direction: spec.position?.direction ?? 'within' };
    }
    // a remembered placement keeps the panel where the user last put it
    const placement = placements[spec.id];
    if (placement) {
        // rejoin a remembered group sibling that is still open (back as a tab)
        const sibling = placement.groupSiblings.find(s => !!api?.getPanel(s));
        if (sibling) {
            return { referencePanel: sibling, direction: 'within' };
        }
        // otherwise reopen its own region next to the graph, same side and size
        return {
            referencePanel: PANEL_GRAPH,
            direction: placement.direction,
            size: placement.size,
        };
    }
    // no memory: join an existing side group as a tab if one exists
    const sibling = firstSidePanelId();
    if (sibling) {
        return { referencePanel: sibling, direction: 'within' as DockDirection };
    }
    // first side panel ever: open the region relative to the graph
    return {
        referencePanel: PANEL_GRAPH,
        direction: (isMobile() ? 'below' : 'right') as DockDirection,
    };
}

export function isPanelOpen(id: string): boolean {
    return !!api?.getPanel(id);
}

export function openPanel(id: string): void {
    if (!api) return;
    const spec = registry.get(id);
    if (!spec) return;
    const existing = api.getPanel(id);
    if (existing) {
        existing.api.setActive();
        spec.onOpen?.();
        return;
    }
    const position = resolvePosition(spec);
    // size only the first side panel (the one opening a fresh region next to the
    // graph); panels joining an existing group as tabs inherit that group's size
    const opensNewRegion = position.referencePanel === PANEL_GRAPH;
    const horizontal = position.direction === 'left' || position.direction === 'right';
    const sizePx = position.size ?? DEFAULT_SIDE_PANEL_PX;
    api.addPanel({
        id,
        component: spec.component,
        title: spec.title,
        ...(spec.tabIcon ? { tabComponent: TAB_WITH_ICON } : {}),
        position: { referencePanel: position.referencePanel, direction: position.direction },
        ...(opensNewRegion
            ? horizontal
                ? { initialWidth: sizePx }
                : { initialHeight: sizePx }
            : {}),
    });
    spec.onOpen?.();
}

export function closePanel(id: string): void {
    const panel = api?.getPanel(id);
    if (panel) api?.removePanel(panel);
}

export function togglePanel(id: string): boolean {
    if (isPanelOpen(id)) {
        closePanel(id);
        return false;
    }
    openPanel(id);
    return true;
}

export function focusPanel(id: string): void {
    api?.getPanel(id)?.api.setActive();
}

// the graph panel is special: it always exists, occupies the center, and its
// group is locked with a hidden header so it can't be dragged or closed
function mountGraphPanel(): void {
    if (!api) return;
    const spec = registry.get(PANEL_GRAPH);
    if (!spec) return;
    const panel = api.addPanel({ id: PANEL_GRAPH, component: spec.component, title: spec.title });
    panel.api.group.locked = true;
    panel.api.group.header.hidden = true;
}

function reassertGraphGroup(): void {
    const panel = api?.getPanel(PANEL_GRAPH);
    if (panel) {
        panel.api.group.locked = true;
        panel.api.group.header.hidden = true;
    }
}

function buildDefaultLayout(): void {
    if (!api) return;
    api.clear();
    mountGraphPanel();
}

// true once dockview's grid reports the same size as the measured container.
// a layout-change event can fire earlier while the grid still holds a tiny
// placeholder size (before its ResizeObserver delivers the real size on first
// paint); persisting/capturing then would store a degenerate equal split that
// later restores as "half screen", and group rects would be measured wrong
function layoutStable(): boolean {
    if (!api) return false;
    const mount = document.getElementById('dock');
    if (!mount || mount.clientWidth === 0 || mount.clientHeight === 0) return false;
    const json = api.toJSON();
    return (
        Math.abs(json.grid.width - mount.clientWidth) <= 2 &&
        Math.abs(json.grid.height - mount.clientHeight) <= 2
    );
}

function saveLayout(): void {
    if (!api) return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(api.toJSON()));
    } catch {
        // ignore quota / serialization failures — persistence is best-effort
    }
}

// classify a panel group's position relative to the graph by comparing their
// centers; geometric so it reflects wherever the user dragged the panel
function deriveDirection(graph: DOMRect, group: DOMRect): DockDirection {
    const dx = (group.left + group.right) / 2 - (graph.left + graph.right) / 2;
    const dy = (group.top + group.bottom) / 2 - (graph.top + graph.bottom) / 2;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
    return dy >= 0 ? 'below' : 'above';
}

// snapshot where each open, identity-bearing panel currently lives so it can be
// reopened in the same spot after a toolbar close or a full reload
function capturePlacements(): void {
    if (!api) return;
    const graphRect = api.getPanel(PANEL_GRAPH)?.api.group.element.getBoundingClientRect();
    let changed = false;
    for (const panel of api.panels) {
        if (panel.id === PANEL_GRAPH) continue;
        const spec = registry.get(panel.id);
        // transient panels (per-selection details) get a fresh id each time and
        // must not own a sticky slot
        if (!spec || spec.transient) continue;
        const group = panel.api.group;
        const rect = group.element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const siblings = group.panels
            .filter(p => p.id !== panel.id && p.id !== PANEL_GRAPH)
            .map(p => p.id);
        const direction = graphRect ? deriveDirection(graphRect, rect) : 'right';
        const horizontal = direction === 'left' || direction === 'right';
        placements[panel.id] = {
            groupSiblings: siblings,
            direction,
            size: Math.round(horizontal ? rect.width : rect.height),
        };
        changed = true;
    }
    if (changed) savePlacements();
}

// when a panel splits into its own group (or one is removed), dockview spreads
// the available space equally across all columns — so dragging a tab out of the
// settings group would suddenly grow settings and shrink the graph. re-impose a
// stable layout where the side panels keep their remembered sizes and the
// center graph absorbs the difference.
//
// splitview honours a setSize exactly on the targeted view and pushes the delta
// to the *last* view in that axis. so we: (1) pin the graph to the leftover
// space, then (2) pin every side panel except the last one per axis — the last
// view then lands on exactly its own target as the remainder, and the graph
// (pinned first) is left untouched.
//
// returns true once the layout already matches the targets (a no-op), so the
// caller can stop re-enforcing; dockview may settle asynchronously after a
// restore, so enforcement is retried on subsequent stable events until it
// converges
function enforceStableSizes(): boolean {
    if (!api || enforcing) return true;
    const graphPanel = api.getPanel(PANEL_GRAPH);
    if (!graphPanel) return true;
    const mount = document.getElementById('dock');
    if (!mount) return true;
    const graphGroup = graphPanel.api.group;
    const graphRect = graphGroup.element.getBoundingClientRect();

    type SideGroup = {
        first: IDockviewPanel;
        target: number;
        horizontal: boolean;
        pos: number;
    };
    const horizontals: SideGroup[] = [];
    const verticals: SideGroup[] = [];
    let sideWidth = 0;
    let sideHeight = 0;
    for (const group of api.groups) {
        if (group === graphGroup) continue;
        const rect = group.element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const first = group.panels[0];
        if (!first) continue;
        // prefer a remembered size from any identity panel in this group,
        // else fall back to the default side-panel width
        let target: number | undefined;
        for (const p of group.panels) {
            const size = placements[p.id]?.size;
            if (size) {
                target = size;
                break;
            }
        }
        const size = target ?? DEFAULT_SIDE_PANEL_PX;
        const direction = deriveDirection(graphRect, rect);
        const horizontal = direction === 'left' || direction === 'right';
        const entry: SideGroup = {
            first,
            target: size,
            horizontal,
            pos: horizontal ? rect.left : rect.top,
        };
        if (horizontal) {
            horizontals.push(entry);
            sideWidth += size;
        } else {
            verticals.push(entry);
            sideHeight += size;
        }
    }
    if (horizontals.length === 0 && verticals.length === 0) return true;

    // the graph should hold the leftover space; if it already does (within a
    // pixel), the layout has converged and no resize is needed
    const targetGraphW = sideWidth > 0 ? Math.max(0, mount.clientWidth - sideWidth) : undefined;
    const targetGraphH = sideHeight > 0 ? Math.max(0, mount.clientHeight - sideHeight) : undefined;
    const wOk = targetGraphW === undefined || Math.abs(graphRect.width - targetGraphW) <= 2;
    const hOk = targetGraphH === undefined || Math.abs(graphRect.height - targetGraphH) <= 2;
    if (wOk && hOk) return true;

    enforcing = true;
    try {
        // pin the graph to the leftover space first
        const graphSize: { width?: number; height?: number } = {};
        if (targetGraphW !== undefined) graphSize.width = targetGraphW;
        if (targetGraphH !== undefined) graphSize.height = targetGraphH;
        graphPanel.api.setSize(graphSize);
        // pin every side panel except the last one per axis; the last view
        // absorbs the remainder, which equals its own target
        const pinAllButLast = (groups: SideGroup[]) => {
            const sorted = [...groups].sort((a, b) => a.pos - b.pos);
            for (let i = 0; i < sorted.length - 1; i++) {
                const g = sorted[i];
                if (g.horizontal) g.first.api.setSize({ width: g.target });
                else g.first.api.setSize({ height: g.target });
            }
        };
        pinAllButLast(horizontals);
        pinAllButLast(verticals);
    } finally {
        enforcing = false;
    }
    return false;
}

// run enforcement on animation frames until the layout converges. this MUST be
// driven by frames, never by the layout-change event: enforceStableSizes calls
// setSize, which itself emits layout-change events — re-triggering enforcement
// from there would recurse forever and freeze the page. the attempt cap is a
// hard safety net so a layout that can't reach its target (e.g. a panel pinned
// at its min size) still settles instead of looping. a single loop runs at a
// time (enforceScheduled), and persistence happens only once it has settled
function scheduleEnforce(): void {
    if (enforceScheduled) return;
    enforceScheduled = true;
    let attempts = 0;
    const kick = () => {
        attempts++;
        if (!api) {
            enforceScheduled = false;
            return;
        }
        if (!layoutStable()) {
            if (attempts < 30) {
                requestAnimationFrame(kick);
            } else {
                enforceScheduled = false;
            }
            return;
        }
        const converged = enforceStableSizes();
        if (converged || attempts >= 30) {
            enforceScheduled = false;
            saveLayout();
            capturePlacements();
        } else {
            requestAnimationFrame(kick);
        }
    };
    requestAnimationFrame(kick);
}

// remove restored panels whose content cannot be rebuilt, and re-render the
// singleton panels (analytics/settings) that were restored open
function reconcileRestoredPanels(): void {
    if (!api) return;
    for (const panel of [...api.panels]) {
        if (panel.id === PANEL_GRAPH) continue;
        const spec = registry.get(panel.id);
        // drop panels we can't rebuild (transient) or whose mode no longer
        // holds (restoreGuard), so a saved layout never resurrects a panel
        // that the current app state forbids
        if (!spec || spec.transient || spec.restoreGuard?.() === false) {
            api.removePanel(panel);
            // removing a panel re-equalizes the remaining groups; remember to
            // re-impose stable sizes once the layout is painted
            pendingEnforce = true;
        } else {
            spec.onOpen?.();
        }
    }
}

function restoreLayout(): boolean {
    if (!api) return false;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return false;
    try {
        restoring = true;
        api.fromJSON(JSON.parse(saved) as SerializedDockview);
        if (!api.getPanel(PANEL_GRAPH)) {
            // saved layout is missing the graph — treat as invalid
            throw new Error('restored layout has no graph panel');
        }
        reassertGraphGroup();
        reconcileRestoredPanels();
        return true;
    } catch (err) {
        console.warn('failed to restore layout, using default', err);
        buildDefaultLayout();
        return false;
    } finally {
        restoring = false;
    }
}

/** Clears the saved layout and rebuilds the default arrangement. */
export function resetLayout(): void {
    try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(PLACEMENTS_KEY);
    } catch {
        // ignore
    }
    placements = {};
    buildDefaultLayout();
}

export function initLayout(): void {
    const mount = document.getElementById('dock');
    if (!mount) throw new Error('Missing element: dock');
    document.body.appendChild(holder);

    api = createDockview(mount, {
        createComponent,
        createTabComponent,
        theme: dockTheme(),
        dndStrategy: 'pointer',
    } as DockviewComponentOptions);

    api.onDidLayoutChange(() => {
        if (!restoring && !enforcing && !enforceScheduled && layoutStable()) {
            const count = api?.groups.length ?? 0;
            const structural = prevGroupCount !== 0 && count !== prevGroupCount;
            prevGroupCount = count;
            if (structural) {
                // a panel split into / out of its own group; dockview equalized
                // the columns — re-impose stable sizes over frames so the graph
                // absorbs the change while side panels keep their size. the
                // scheduler persists once it has settled
                scheduleEnforce();
            } else {
                saveLayout();
                capturePlacements();
            }
        }
        emit(EVT_LAYOUT_CHANGED, null);
    });

    api.onDidRemovePanel(panel => {
        detachElement(panel.id);
        registry.get(panel.id)?.onClose?.();
    });

    // middle-click a tab to close it, matching the common browser-tab
    // convention; dockview drives tabs with pointer events and prevents the
    // default mouse events, so listen on pointerdown in the capture phase
    mount.addEventListener(
        'pointerdown',
        event => {
            if (event.button !== 1 || !api) return;
            const tab = (event.target as HTMLElement | null)?.closest('.dv-tab');
            if (!tab) return;
            for (const group of api.groups) {
                const tabs = [...group.element.querySelectorAll('.dv-tab')];
                const index = tabs.indexOf(tab);
                if (index === -1) continue;
                const panel = group.panels[index];
                // the graph lives in a locked group and must never be closed
                if (panel && panel.id !== PANEL_GRAPH) {
                    event.preventDefault();
                    api.removePanel(panel);
                }
                return;
            }
        },
        true,
    );

    on(EVT_THEME_CHANGED, () => {
        api?.updateOptions({ theme: dockTheme() });
    });

    if (!restoreLayout()) {
        buildDefaultLayout();
    }
    // seed the structural-change baseline so the first user action compares
    // against the as-initialized group count
    prevGroupCount = api.groups.length;
    // a restore that dropped a guarded panel re-equalizes the remaining groups
    // during deserialization (while enforcement is suppressed). on a reload the
    // container is already sized, so dockview emits no further layout event to
    // trigger enforcement — kick the bounded scheduler so the graph reclaims the
    // freed space once the grid geometry is ready
    if (pendingEnforce) {
        pendingEnforce = false;
        scheduleEnforce();
    }
}
