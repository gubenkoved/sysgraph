import { createProjection, type ProjectedPoint, projectPoint } from './projection.js';
import type { CameraState } from './renderer.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const AXIS_WORLD_LENGTH_FRACTION = 0.033;
const CENTER_CROSS_WORLD_LENGTH_FRACTION = 0.008;
const HOLD_MS = 900;
const FADE_MS = 400;

/** Project the orbit pivot and both ends of three world-space axes. */
export function projectCameraAxes(camera: CameraState, width: number, height: number,
    lengthFraction = AXIS_WORLD_LENGTH_FRACTION): {
    pivot: ProjectedPoint;
    ends: ProjectedPoint[];
    oppositeEnds: ProjectedPoint[];
} {
    const projection = createProjection(camera, width, height);
    const pivot = { x: 0, y: 0, factor: 1 };
    const centerZ = camera.centerZ ?? 0;
    projectPoint(projection, camera.centerX, camera.centerY, centerZ, pivot);
    const worldLength = camera.referenceDistance * lengthFraction;
    const ends = Array.from({ length: 3 }, () => ({ x: 0, y: 0, factor: 1 }));
    const oppositeEnds = Array.from({ length: 3 }, () => ({ x: 0, y: 0, factor: 1 }));
    projectPoint(projection, camera.centerX + worldLength, camera.centerY, centerZ, ends[0]!);
    projectPoint(projection, camera.centerX, camera.centerY + worldLength, centerZ, ends[1]!);
    projectPoint(projection, camera.centerX, camera.centerY, centerZ + worldLength, ends[2]!);
    projectPoint(projection, camera.centerX - worldLength, camera.centerY, centerZ, oppositeEnds[0]!);
    projectPoint(projection, camera.centerX, camera.centerY - worldLength, centerZ, oppositeEnds[1]!);
    projectPoint(projection, camera.centerX, camera.centerY, centerZ - worldLength, oppositeEnds[2]!);
    return { pivot, ends, oppositeEnds };
}

function svgElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
    return document.createElementNS(SVG_NS, name);
}

interface AxisParts {
    backing: SVGLineElement;
    line: SVGLineElement;
    tip: SVGCircleElement;
    label: SVGTextElement;
}

/** A corner orientation guide plus a restrained cross at the actual orbit pivot. */
export class CameraAxisOverlay {
    readonly element = svgElement('svg');
    readonly cornerElement = svgElement('g');
    readonly centerElement = svgElement('g');
    private readonly axes: AxisParts[] = [];
    private readonly centerLines: SVGLineElement[] = [];
    private readonly pivot = svgElement('circle');
    private readonly pivotDot = svgElement('circle');
    private previous: number[] | null = null;
    private lastGeometry: number[] | null = null;
    private changedAt = -Infinity;

    constructor(host: HTMLElement, private readonly corner = { left: 54, bottom: 64 }) {
        this.element.setAttribute('aria-hidden', 'true');
        this.element.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;overflow:hidden;opacity:0';
        this.centerElement.style.opacity = '0';
        for (const [name, color] of [['X', '#dc6258'], ['Y', '#30a875'], ['Z', '#478ad4']]) {
            const backing = svgElement('line');
            backing.setAttribute('stroke-width', '5');
            backing.setAttribute('stroke-linecap', 'round');
            const line = svgElement('line');
            line.setAttribute('stroke', color);
            line.setAttribute('stroke-width', '2.6');
            line.setAttribute('stroke-linecap', 'round');
            const tip = svgElement('circle');
            tip.setAttribute('r', '3.5');
            tip.setAttribute('fill', color);
            tip.setAttribute('stroke-width', '1.5');
            const label = svgElement('text');
            label.textContent = name;
            label.setAttribute('fill', color);
            label.setAttribute('font-family', 'Ubuntu, Segoe UI, Arial, sans-serif');
            label.setAttribute('font-size', '12');
            label.setAttribute('font-weight', '700');
            label.setAttribute('text-anchor', 'middle');
            label.setAttribute('dominant-baseline', 'middle');
            label.setAttribute('stroke-width', '3');
            label.setAttribute('stroke-linejoin', 'round');
            label.setAttribute('paint-order', 'stroke');
            this.cornerElement.append(backing, line, tip, label);
            this.axes.push({ backing, line, tip, label });
            const centerLine = svgElement('line');
            centerLine.setAttribute('stroke-width', '1.6');
            centerLine.setAttribute('stroke-linecap', 'round');
            this.centerElement.append(centerLine);
            this.centerLines.push(centerLine);
        }
        this.pivot.setAttribute('r', '6');
        this.pivot.setAttribute('stroke-width', '1.5');
        this.pivotDot.setAttribute('r', '2');
        this.cornerElement.append(this.pivot, this.pivotDot);
        this.element.append(this.cornerElement, this.centerElement);
        host.append(this.element);
    }

    update(camera: CameraState, width: number, height: number, now: number, active = false, suppress = false): void {
        if (!camera.mode3d || width <= 0 || height <= 0) { this.hide(); return; }
        const values = [camera.centerX, camera.centerY, camera.centerZ ?? 0, camera.scale, camera.yaw, camera.pitch,
            camera.distance, camera.referenceDistance];
        if (suppress) {
            // Keep the baseline in sync so the guide does not flash after an
            // automatic camera pan finishes. The next manual change still shows it.
            this.previous = values;
            this.changedAt = -Infinity;
            this.element.style.opacity = '0';
            this.centerElement.style.opacity = '0';
            return;
        }
        if (active || !this.previous || values.some((value, index) => value !== this.previous![index])) this.changedAt = now;
        this.previous = values;
        const opacity = Math.min(1, Math.max(0, (this.changedAt + HOLD_MS + FADE_MS - now) / FADE_MS));
        this.element.style.opacity = '1';
        this.centerElement.style.opacity = String(opacity * 0.72);
        const dark = document.documentElement.getAttribute('data-theme') !== 'light';
        const geometry = [...values, width, height, Number(dark)];
        if (this.lastGeometry?.length === geometry.length &&
            this.lastGeometry.every((value, index) => value === geometry[index])) return;
        this.lastGeometry = geometry;
        this.element.setAttribute('viewBox', `0 0 ${width} ${height}`);

        const { pivot, ends } = projectCameraAxes(camera, width, height);
        const axisLength = Math.max(1, ...ends.map(end => Math.hypot(end.x - pivot.x, end.y - pivot.y)));
        const cornerScale = 32 / axisLength;
        const x = Math.min(this.corner.left, Math.max(48, width - 48));
        const y = Math.max(48, height - this.corner.bottom);
        const backing = dark ? '#07131a' : '#ffffff';
        for (let index = 0; index < this.axes.length; index++) {
            const axis = this.axes[index]!;
            const endX = x + (ends[index]!.x - pivot.x) * cornerScale;
            const endY = y + (ends[index]!.y - pivot.y) * cornerScale;
            const directionX = endX - x;
            const directionY = endY - y;
            const length = Math.hypot(directionX, directionY);
            const fallback = [[1, -1], [0, 1], [-1, -1]][index]!;
            const labelX = endX + (length > 0.15 ? directionX / length : fallback[0]!) * 11;
            const labelY = endY + (length > 0.15 ? directionY / length : fallback[1]!) * 11;
            for (const line of [axis.backing, axis.line]) {
                line.setAttribute('x1', String(x));
                line.setAttribute('y1', String(y));
                line.setAttribute('x2', String(endX));
                line.setAttribute('y2', String(endY));
            }
            axis.backing.setAttribute('stroke', backing);
            axis.tip.setAttribute('cx', String(endX));
            axis.tip.setAttribute('cy', String(endY));
            axis.tip.setAttribute('stroke', backing);
            axis.label.setAttribute('x', String(labelX));
            axis.label.setAttribute('y', String(labelY));
            axis.label.setAttribute('stroke', backing);
        }
        for (const circle of [this.pivot, this.pivotDot]) {
            circle.setAttribute('cx', String(x));
            circle.setAttribute('cy', String(y));
        }
        this.pivot.setAttribute('fill', backing);
        this.pivot.setAttribute('stroke', dark ? '#c8d6d4' : '#40505c');
        this.pivotDot.setAttribute('fill', dark ? '#c8d6d4' : '#40505c');

        const cross = projectCameraAxes(camera, width, height, CENTER_CROSS_WORLD_LENGTH_FRACTION);
        for (let index = 0; index < this.centerLines.length; index++) {
            const line = this.centerLines[index]!;
            line.setAttribute('x1', String(cross.oppositeEnds[index]!.x));
            line.setAttribute('y1', String(cross.oppositeEnds[index]!.y));
            line.setAttribute('x2', String(cross.ends[index]!.x));
            line.setAttribute('y2', String(cross.ends[index]!.y));
            line.setAttribute('stroke', dark ? '#b8cbd0' : '#667b88');
        }
    }

    hide(): void {
        this.element.style.opacity = '0';
        this.centerElement.style.opacity = '0';
        this.previous = null;
    }

    destroy(): void { this.element.remove(); }
}
