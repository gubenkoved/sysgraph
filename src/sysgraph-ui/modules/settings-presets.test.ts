import { afterEach, describe, expect, it } from 'vitest';
import { settings } from './settings.js';
import { applyEmbeddedDisplaySettings, resetSettingsToDefaults } from './settings-presets.js';

afterEach(() => resetSettingsToDefaults());

describe('legacy display migration', () => {
    it('maps authored D3 force values to GPU settings and discards obsolete controls', () => {
        applyEmbeddedDisplaySettings({
            d3EnablePhysics: false,
            d3LinkDistance: 220,
            d3LinkDistanceMode: 'expression',
            d3LinkDistanceExpression: 'Number(properties.length) || 220',
            d3Charge: -300,
            d3LinkStrength: 0.9,
            d3CollisionMultiplier: 0,
            d3VelocityDecay: 0.5,
            d3ForceXYStrength: 0,
        });

        expect(settings.gpuEnablePhysics).toBe(false);
        expect(settings.gpuLinkDistance).toBe(220);
        expect(settings.gpuLinkDistanceMode).toBe('expression');
        expect(settings.gpuLinkDistanceExpression).toBe('Number(properties.length) || 220');
        expect(settings.gpuCharge).toBe(-300);
        expect(settings.gpuLinkStrength).toBe(0.9);
        expect(settings.gpuCollisionMultiplier).toBe(0);
        expect(settings.gpuVelocityDecay).toBe(0.5);
        expect(settings.gpuForceXYStrength).toBe(0);
        expect('d3Charge' in settings).toBe(false);
    });

    it('keeps automatic layout choices in embedded display settings', () => {
        applyEmbeddedDisplaySettings({ layoutMode: 'radial', layoutSpacing: 120,
            layoutRankSpacing: 180, layoutRootId: 'hub' });
        expect(settings.layoutMode).toBe('radial');
        expect(settings.layoutSpacing).toBe(120);
        expect(settings.layoutRankSpacing).toBe(180);
        expect(settings.layoutRootId).toBe('hub');
        resetSettingsToDefaults();
        expect(settings.layoutMode).toBe('force');
    });

    it('ignores unknown layout names and directions in imported display settings', () => {
        applyEmbeddedDisplaySettings({ layoutMode: 'unknown', layoutDirection: 'sideways' });
        expect(settings.layoutMode).toBe('force');
        expect(settings.layoutDirection).toBe('TB');
    });
});
