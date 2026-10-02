/// <reference types="vite/client" />

/**
 * Build-time constant injected by Vite (`define` in vite.config.ts).
 * When true the UI runs in standalone mode and never contacts the backend.
 */
declare const __STANDALONE__: boolean;

// TypeScript's current DOM WebGPU types include the interfaces but omit these
// browser-provided flag objects. Keep their declarations local to this app.
declare const GPUShaderStage: {
    readonly VERTEX: GPUShaderStageFlags;
    readonly FRAGMENT: GPUShaderStageFlags;
    readonly COMPUTE: GPUShaderStageFlags;
};

declare const GPUBufferUsage: {
    readonly COPY_SRC: GPUBufferUsageFlags;
    readonly COPY_DST: GPUBufferUsageFlags;
    readonly MAP_READ: GPUBufferUsageFlags;
    readonly UNIFORM: GPUBufferUsageFlags;
    readonly STORAGE: GPUBufferUsageFlags;
};

declare const GPUMapMode: {
    readonly READ: GPUMapModeFlags;
};

declare const GPUTextureUsage: {
    readonly COPY_DST: GPUTextureUsageFlags;
    readonly RENDER_ATTACHMENT: GPUTextureUsageFlags;
    readonly TEXTURE_BINDING: GPUTextureUsageFlags;
};
