import { afterEach, describe, expect, it } from 'vitest';
import { settings } from './settings.js';
import { applyEmbeddedDisplaySettings, exportSettingsToJson, importSettingsFromJson, resetSettingsToDefaults } from './settings-presets.js';

afterEach(() => resetSettingsToDefaults());

describe('legacy display migration', () => {
    it('defaults to Solid while respecting a saved Simple choice', () => {
        resetSettingsToDefaults();
        expect(settings.nodeRenderStyle).toBe('solid');
        applyEmbeddedDisplaySettings({ nodeRenderStyle: 'simple' });
        expect(settings.nodeRenderStyle).toBe('simple');
        resetSettingsToDefaults();
        expect(settings.nodeRenderStyle).toBe('solid');
    });

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

    it('applies supported label styles and rejects unsupported values', () => {
        applyEmbeddedDisplaySettings({ labelStyle: 'soft-background' });
        expect(settings.labelStyle).toBe('soft-background');
        applyEmbeddedDisplaySettings({ labelStyle: 'plate' });
        expect(settings.labelStyle).toBe('plate');
        applyEmbeddedDisplaySettings({ labelStyle: 'unknown' });
        expect(settings.labelStyle).toBe('outlined');
    });

    it('applies supported text rendering methods and rejects unsupported values', () => {
        applyEmbeddedDisplaySettings({ labelRendering: 'glyphs-filtered' });
        expect(settings.labelRendering).toBe('glyphs-filtered');
        applyEmbeddedDisplaySettings({ labelRendering: 'whole-snapped' });
        expect(settings.labelRendering).toBe('whole-snapped');
        applyEmbeddedDisplaySettings({ labelRendering: 'unknown' });
        expect(settings.labelRendering).toBe('glyphs-filtered');
    });

    it('round-trips grid visibility and world spacing while rejecting invalid imports', () => {
        expect(settings.showGrid).toBe(false);
        expect(settings.gridStep).toBe(100);
        applyEmbeddedDisplaySettings({ showGrid: true, gridStep: 175 });
        const exported = JSON.parse(exportSettingsToJson()) as Record<string, unknown>;
        expect(exported.showGrid).toBe(true);
        expect(exported.gridStep).toBe(175);

        importSettingsFromJson('{"showGrid":"true","gridStep":-10}');
        expect(settings.showGrid).toBe(true);
        expect(settings.gridStep).toBe(175);
        resetSettingsToDefaults();
        expect(settings.showGrid).toBe(false);
        expect(settings.gridStep).toBe(100);
    });

    it('round-trips scene brightness and rejects values outside its range', () => {
        expect(settings.sceneBrightness).toBe(1.2);
        applyEmbeddedDisplaySettings({ sceneBrightness: 1.65 });
        expect(settings.sceneBrightness).toBe(1.65);
        const exported = JSON.parse(exportSettingsToJson()) as Record<string, unknown>;
        expect(exported.sceneBrightness).toBe(1.65);

        importSettingsFromJson('{"sceneBrightness":2}');
        expect(settings.sceneBrightness).toBe(2);
        importSettingsFromJson('{"sceneBrightness":0.5}');
        expect(settings.sceneBrightness).toBe(0.5);
        importSettingsFromJson('{"sceneBrightness":0.49}');
        importSettingsFromJson('{"sceneBrightness":"bright"}');
        expect(settings.sceneBrightness).toBe(0.5);

        applyEmbeddedDisplaySettings({ sceneBrightness: Number.POSITIVE_INFINITY });
        expect(settings.sceneBrightness).toBe(1.2);
    });
});
