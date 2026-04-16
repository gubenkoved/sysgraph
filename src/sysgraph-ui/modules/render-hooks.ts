type FrameHook = () => void;

let _onFramePre: FrameHook | null = null;
let _onFramePost: FrameHook | null = null;

export function setFrameHooks(pre: FrameHook | null, post: FrameHook | null): void {
    _onFramePre = pre;
    _onFramePost = post;
}

export function callFramePre(): void {
    _onFramePre?.();
}

export function callFramePost(): void {
    _onFramePost?.();
}
