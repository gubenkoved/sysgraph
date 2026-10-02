const WINDOW_OPTIONS = [5, 10, 30] as const;
type WindowSeconds = typeof WINDOW_OPTIONS[number];
const WINDOW_STORAGE_KEY = 'sysgraph:fps-history-window';
const MAX_HISTORY_MS = 30_000;
const UPDATE_INTERVAL_MS = 500;
const DRAW_INTERVAL_MS = 100;
const PAUSE_GAP_MS = 10_000;

interface FrameSample {
    timestamp: number;
    interval: number;
}

function savedWindowSeconds(): WindowSeconds {
    try {
        const stored = localStorage.getItem(WINDOW_STORAGE_KEY);
        return WINDOW_OPTIONS.find(option => String(option) === stored) ?? 10;
    } catch { return 10; }
}

export interface FpsMeter {
    element: HTMLElement;
    summaryValue: HTMLOutputElement;
    frame(timestamp: number): void;
}

/** A compact history of animation-frame intervals. Tall bars reveal dropped frames. */
export function createFpsMeter(): FpsMeter {
    const element = document.createElement('div');
    element.className = 'sg-fps-meter sg-setting-span-full';

    const header = document.createElement('div');
    header.className = 'sg-fps-meter-head';
    const label = document.createElement('span');
    label.className = 'sg-fps-meter-label';
    label.textContent = 'Frame rate';
    const windowControl = document.createElement('div');
    windowControl.className = 'sg-fps-meter-window';
    windowControl.setAttribute('role', 'group');
    windowControl.setAttribute('aria-label', 'Frame history span');
    const windowButtons = new Map<WindowSeconds, HTMLButtonElement>();
    let windowSeconds = savedWindowSeconds();
    for (const seconds of WINDOW_OPTIONS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = `${seconds}s`;
        button.setAttribute('aria-pressed', String(windowSeconds === seconds));
        button.addEventListener('click', () => selectWindow(seconds));
        windowControl.appendChild(button);
        windowButtons.set(seconds, button);
    }
    const reading = document.createElement('span');
    reading.className = 'sg-fps-meter-reading';
    const value = document.createElement('output');
    value.className = 'sg-fps-meter-value';
    value.textContent = '—';
    value.setAttribute('aria-live', 'off');
    const unit = document.createElement('span');
    unit.className = 'sg-fps-meter-unit';
    unit.textContent = 'fps';
    reading.append(value, unit);
    header.append(label, windowControl, reading);

    const graph = document.createElement('canvas');
    graph.className = 'sg-fps-meter-graph';
    graph.setAttribute('role', 'img');
    graph.setAttribute('aria-label', `${windowSeconds}-second frame-time history`);
    graph.dataset.appTooltip = 'Each bar shows the slowest frame in that time slice. Amber and red bars mark delays.';
    element.append(header, graph);

    const summaryValue = document.createElement('output');
    summaryValue.className = 'sg-settings-fps';
    summaryValue.textContent = 'FPS —';
    summaryValue.setAttribute('aria-live', 'off');

    const history: FrameSample[] = [];
    let historyStart = 0;
    let lastFrame: number | null = null;
    let windowStart: number | null = null;
    let framesInWindow = 0;
    let lastDraw = 0;
    let currentFps: number | null = null;

    const updateDescription = (): void => {
        const rate = currentFps === null ? '' : `, currently ${currentFps} frames per second`;
        graph.setAttribute('aria-label', `${windowSeconds}-second frame-time history${rate}`);
    };

    const draw = (): void => {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.round(graph.clientWidth * ratio);
        const height = Math.round(graph.clientHeight * ratio);
        if (width < 1 || height < 1) return;
        if (graph.width !== width || graph.height !== height) {
            graph.width = width;
            graph.height = height;
        }
        const context = graph.getContext('2d');
        if (!context) return;
        context.clearRect(0, 0, width, height);
        if (lastFrame === null || historyStart >= history.length) return;

        const plotLeft = 4 * ratio;
        const plotWidth = width - plotLeft * 2;
        const plotHeight = height - 6 * ratio;
        if (plotWidth <= 0 || plotHeight <= 0) return;
        const preferredStep = Math.max(2.5, Math.min(4.5, plotWidth / (100 * ratio))) * ratio;
        const columnWidth = Math.max(2, Math.round(preferredStep));
        const windowMs = windowSeconds * 1000;
        const firstTimestamp = lastFrame - windowMs;
        const bucketMs = windowMs * columnWidth / plotWidth;
        const firstBucket = Math.floor(firstTimestamp / bucketMs);
        const columns = Math.ceil(plotWidth / columnWidth) + 2;
        const maxIntervals = new Float32Array(columns);
        let firstVisible = historyStart;
        while (firstVisible < history.length && history[firstVisible]!.timestamp < firstTimestamp) firstVisible++;
        const visibleCount = history.length - firstVisible;
        if (!visibleCount) return;
        const baselineSamples: number[] = [];
        for (let index = firstVisible; index < history.length; index++) {
            const sample = history[index]!;
            const column = Math.floor(sample.timestamp / bucketMs) - firstBucket;
            if (column < 0 || column >= columns) continue;
            maxIntervals[column] = Math.max(maxIntervals[column]!, sample.interval);
            baselineSamples.push(sample.interval);
        }
        const sorted = baselineSamples.sort((a, b) => a - b);
        const baseline = sorted[Math.floor((sorted.length - 1) * 0.2)]!;
        const slowFrame = Math.max(baseline * 1.55, baseline + 4);
        const chartMax = Math.max(26, baseline * 2.8);
        const style = getComputedStyle(element);
        const accent = style.getPropertyValue('--sg-accent').trim();
        const warning = style.getPropertyValue('--accent-warning').trim();
        const danger = style.getPropertyValue('--accent-danger').trim();
        const bottom = height - 3 * ratio;

        context.strokeStyle = accent;
        context.globalAlpha = 0.28;
        context.lineWidth = ratio;
        context.setLineDash([2 * ratio, 3 * ratio]);
        const guideY = bottom - Math.min(slowFrame / chartMax, 1) * plotHeight;
        context.beginPath();
        context.moveTo(plotLeft, guideY);
        context.lineTo(width - plotLeft, guideY);
        context.stroke();
        context.setLineDash([]);

        const firstX = Math.round(plotLeft + (firstBucket * bucketMs - firstTimestamp) * plotWidth / windowMs);
        const barWidth = Math.max(1, columnWidth - Math.round(ratio));
        const latestBucket = Math.floor(lastFrame / bucketMs) - firstBucket;
        context.save();
        context.beginPath();
        context.rect(plotLeft, 0, plotWidth, height);
        context.clip();
        for (let index = 0; index < columns; index++) {
            const interval = maxIntervals[index]!;
            if (!interval) continue;
            const barHeight = Math.max(2 * ratio, Math.min(interval / chartMax, 1) * plotHeight);
            context.fillStyle = interval >= baseline * 2.4 ? danger : interval >= slowFrame ? warning : accent;
            context.globalAlpha = interval >= slowFrame || index === latestBucket ? 0.95 : 0.7;
            context.fillRect(firstX + index * columnWidth, bottom - barHeight, barWidth, barHeight);
        }
        context.restore();
        context.globalAlpha = 1;
    };

    function selectWindow(seconds: WindowSeconds): void {
        if (windowSeconds === seconds) return;
        windowSeconds = seconds;
        for (const [option, button] of windowButtons) {
            button.setAttribute('aria-pressed', String(option === seconds));
        }
        updateDescription();
        draw();
        try { localStorage.setItem(WINDOW_STORAGE_KEY, String(seconds)); } catch { /* optional */ }
    }

    const reset = (): void => {
        history.length = 0;
        historyStart = 0;
        lastFrame = null;
        windowStart = null;
        framesInWindow = 0;
        lastDraw = 0;
        currentFps = null;
        value.textContent = '—';
        summaryValue.textContent = 'FPS —';
        updateDescription();
        draw();
    };

    new ResizeObserver(draw).observe(graph);
    document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });

    return {
        element,
        summaryValue,
        frame(timestamp: number): void {
            if (document.hidden || !Number.isFinite(timestamp)) return;
            if (lastFrame === null) {
                lastFrame = timestamp;
                windowStart = timestamp;
                return;
            }
            const interval = timestamp - lastFrame;
            lastFrame = timestamp;
            if (interval <= 0) return;
            if (interval > PAUSE_GAP_MS) {
                reset();
                lastFrame = timestamp;
                windowStart = timestamp;
                return;
            }
            history.push({ timestamp, interval });
            const cutoff = timestamp - MAX_HISTORY_MS;
            while (historyStart < history.length && history[historyStart]!.timestamp < cutoff) historyStart++;
            if (historyStart > 2048 && historyStart > history.length / 2) {
                history.splice(0, historyStart);
                historyStart = 0;
            }
            framesInWindow++;
            if (windowStart !== null && timestamp - windowStart >= UPDATE_INTERVAL_MS) {
                const fps = Math.round(framesInWindow * 1000 / (timestamp - windowStart));
                currentFps = fps;
                value.textContent = String(fps);
                summaryValue.textContent = `FPS ${fps}`;
                updateDescription();
                framesInWindow = 0;
                windowStart = timestamp;
            }
            if (timestamp - lastDraw >= DRAW_INTERVAL_MS) {
                draw();
                lastDraw = timestamp;
            }
        },
    };
}
