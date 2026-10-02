import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraAxisOverlay, projectCameraAxes } from './camera-axis.js';
import type { CameraState } from './renderer.js';

const camera: CameraState = {
    centerX: 120, centerY: -80, scale: 1, stroke: 1,
    mode3d: true, yaw: 0.5, pitch: 0.3, distance: 1000, referenceDistance: 1000,
};

afterEach(() => vi.unstubAllGlobals());

describe('camera axis projection', () => {
    it('scales every axis with camera zoom while keeping the orbit pivot centered', () => {
        const base = projectCameraAxes(camera, 800, 600);
        const scaled = projectCameraAxes({ ...camera, scale: 2 }, 800, 600);
        const closer = projectCameraAxes({ ...camera, distance: 500 }, 800, 600);

        expect(base.pivot).toMatchObject({ x: 400, y: 300 });
        expect(scaled.pivot).toMatchObject({ x: 400, y: 300 });
        expect(closer.pivot).toMatchObject({ x: 400, y: 300 });
        for (let index = 0; index < 3; index++) {
            const baseX = base.ends[index]!.x - base.pivot.x;
            const baseY = base.ends[index]!.y - base.pivot.y;
            expect(scaled.ends[index]!.x - scaled.pivot.x).toBeCloseTo(baseX * 2);
            expect(scaled.ends[index]!.y - scaled.pivot.y).toBeCloseTo(baseY * 2);
            expect(scaled.oppositeEnds[index]!.x - scaled.pivot.x)
                .toBeCloseTo((base.oppositeEnds[index]!.x - base.pivot.x) * 2);
            expect(Math.hypot(closer.ends[index]!.x - closer.pivot.x, closer.ends[index]!.y - closer.pivot.y))
                .toBeGreaterThan(Math.hypot(baseX, baseY));
        }
    });
});

describe('camera axis visibility', () => {
    it('keeps the full guide in the corner while only the small center cross follows zoom', () => {
        const createElementNS = () => {
            const attributes = new Map<string, string>();
            return {
                style: { opacity: '0', cssText: '' },
                children: [] as HTMLElement[],
                setAttribute: (name: string, value: string) => attributes.set(name, value),
                getAttribute: (name: string) => attributes.get(name) ?? null,
                append(...children: HTMLElement[]) { this.children.push(...children); },
                remove: () => {},
                textContent: '',
            };
        };
        vi.stubGlobal('document', {
            createElementNS,
            documentElement: { getAttribute: () => 'light' },
        });
        const axis = new CameraAxisOverlay({ append: () => {} } as unknown as HTMLElement);
        const length = (line: Element): number => Math.hypot(
            Number(line.getAttribute('x2')) - Number(line.getAttribute('x1')),
            Number(line.getAttribute('y2')) - Number(line.getAttribute('y1')),
        );

        axis.update(camera, 800, 600, 100);
        const cornerLine = axis.cornerElement.children[1]!;
        const centerLine = axis.centerElement.children[0]!;
        const cornerLength = length(cornerLine);
        const centerLength = length(centerLine);
        expect(axis.cornerElement.children).toHaveLength(14); // Three labeled axes and the pivot marker.
        expect(axis.centerElement.children).toHaveLength(3); // Only three lines at the rotation center.
        expect(Number(cornerLine.getAttribute('x1'))).toBe(54);
        expect(Number(cornerLine.getAttribute('y1'))).toBe(536);

        axis.update({ ...camera, scale: 2 }, 800, 600, 200);
        expect(length(cornerLine)).toBeCloseTo(cornerLength);
        expect(length(centerLine)).toBeCloseTo(centerLength * 2);

        axis.update({ ...camera, scale: 2 }, 800, 600, 2000);
        expect(axis.element.style.opacity).toBe('1');
        expect(axis.centerElement.style.opacity).toBe('0');
    });

    it('stays hidden after an automatic pan, then responds to manual camera movement', () => {
        const createElementNS = () => ({
            style: { opacity: '0' }, setAttribute: () => {}, append: () => {}, remove: () => {},
            textContent: '',
        });
        vi.stubGlobal('document', {
            createElementNS,
            documentElement: { getAttribute: () => 'light' },
        });
        const axis = new CameraAxisOverlay({ append: () => {} } as unknown as HTMLElement);
        axis.update(camera, 800, 600, 100);
        expect(axis.element.style.opacity).toBe('1');

        const moved = { ...camera, centerX: camera.centerX + 50 };
        axis.update(moved, 800, 600, 200, false, true);
        expect(axis.element.style.opacity).toBe('0');
        axis.update(moved, 800, 600, 216);
        expect(axis.element.style.opacity).toBe('1');
        expect(axis.centerElement.style.opacity).toBe('0');

        axis.update({ ...moved, centerX: moved.centerX + 10 }, 800, 600, 232);
        expect(axis.element.style.opacity).toBe('1');
        expect(Number(axis.centerElement.style.opacity)).toBeGreaterThan(0);
    });
});
