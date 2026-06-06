// long-press gesture support for touch devices
//
// touch devices have no right-click, so the force-graph context menu
// (node / link / background) would be unreachable. on a steady long press we
// hit-test the graph ourselves and open the same context menu used by
// desktop right-click.
//
// implementation notes:
//  - on Android the touchstart/move/end listeners on #graph may not fire,
//    because d3-zoom on the inner force-graph canvas stops propagation. so the
//    primary trigger is the native `contextmenu` event (which still reaches
//    #graph). a long-press timer is kept as a fallback for engines that
//    suppress `contextmenu` under `touch-action: none`.
//  - the `contextmenu` listener runs in the capture phase so it beats the
//    global window listener in context-menu.ts (which would hide our menu).
//  - because the touch listeners aren't guaranteed to fire, we dedup the two
//    possible triggers by timestamp rather than a per-gesture flag.

import { getNodeAtScreen, showBackgroundContextMenu, showNodeContextMenu } from './graph-ui.js';

// how long the finger must stay down to count as a long press
const LONG_PRESS_MS = 500;
// how far the finger may move before the gesture is treated as a pan
const MOVE_CANCEL_PX = 10;
// window after a touchstart during which a contextmenu is treated as touch-born
const TOUCH_CONTEXTMENU_WINDOW_MS = 1500;
// dedup window so the timer and native contextmenu don't both open one gesture
const OPEN_DEDUP_MS = 700;

/**
 * Wires long-press detection on the graph container so touch users can open
 * the context menu. On a steady single-finger hold it hit-tests the graph and
 * shows the node or background context menu at the touch location.
 */
export function initLongPress(): void {
    const graphContainer = document.getElementById('graph') as HTMLElement;

    let timer: number | null = null;
    let startX = 0;
    let startY = 0;
    // timestamp of the most recent single-finger touchstart
    let lastTouchStart = 0;
    // whether the finger has moved beyond the pan threshold this gesture
    let moved = false;
    // timestamp of the last menu open, used to dedup the timer and the native
    // contextmenu event (which both fire for one gesture). a timestamp — not a
    // per-gesture boolean — because on Android the touch listeners may not fire
    // (d3-zoom on the canvas swallows them), so there is no reliable per-gesture
    // reset; each genuine long-press is naturally seconds apart
    let lastOpenTime = 0;

    const clearTimer = (): void => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    };

    // opens the menu, deduped against a near-simultaneous second trigger and
    // suppressed if the finger panned. the browser only fires `contextmenu`
    // after a stationary hold, so relying on it gives us pan-rejection for free
    const tryOpen = (clientX: number, clientY: number): void => {
        const now = performance.now();
        if (now - lastOpenTime < OPEN_DEDUP_MS) return;
        if (moved) return;
        lastOpenTime = now;
        openContextMenu(clientX, clientY);
    };

    // touch listeners are registered in the CAPTURE phase so they run before
    // d3-zoom's handlers on the inner canvas can stop propagation — otherwise
    // touchstart/move/end never reach us on Android and pan-detection breaks
    graphContainer.addEventListener(
        'touchstart',
        (event) => {
            // single-finger only — ignore pinch/zoom and other gestures
            if (event.touches.length !== 1) {
                clearTimer();
                lastTouchStart = 0;
                return;
            }
            const touch = event.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;
            lastTouchStart = performance.now();
            moved = false;

            clearTimer();
            // fallback trigger for engines that suppress the native contextmenu
            timer = window.setTimeout(() => {
                timer = null;
                tryOpen(startX, startY);
            }, LONG_PRESS_MS);
        },
        { passive: true, capture: true },
    );

    graphContainer.addEventListener(
        'touchmove',
        (event) => {
            const touch = event.touches[0];
            if (touch == null) return;
            const dx = touch.clientX - startX;
            const dy = touch.clientY - startY;
            // moved too far — this is a pan, not a long press
            if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
                moved = true;
                clearTimer();
            }
        },
        { passive: true, capture: true },
    );

    graphContainer.addEventListener('touchend', clearTimer, { passive: true, capture: true });
    graphContainer.addEventListener('touchcancel', clearTimer, { passive: true, capture: true });

    // primary trigger. registered in the capture phase so we run before the
    // global window `contextmenu` listener (which would hide the menu) and
    // before force-graph's own handler. we only intercept touch-originated
    // context menus; desktop right-clicks fall through to force-graph.
    graphContainer.addEventListener(
        'contextmenu',
        (event) => {
            const firesTouchEvents = (event as MouseEvent & {
                sourceCapabilities?: { firesTouchEvents?: boolean };
            }).sourceCapabilities?.firesTouchEvents;
            const recentTouch = performance.now() - lastTouchStart < TOUCH_CONTEXTMENU_WINDOW_MS;
            if (!firesTouchEvents && !recentTouch) return;

            event.preventDefault();
            event.stopPropagation();
            tryOpen(event.clientX, event.clientY);
        },
        { capture: true },
    );
}

/**
 * Opens the appropriate context menu for the given screen coordinates: the node
 * menu when a node is under the finger, otherwise the background menu.
 */
function openContextMenu(clientX: number, clientY: number): void {
    const node = getNodeAtScreen(clientX, clientY);

    // light haptic feedback where supported
    navigator.vibrate?.(10);

    if (node != null) {
        showNodeContextMenu(node, clientX, clientY);
    } else {
        showBackgroundContextMenu(clientX, clientY);
    }
}
