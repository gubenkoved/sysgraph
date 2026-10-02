type FrameHook = (timestamp: number) => void;

let _onFramePre: FrameHook | null = null;
let _onFramePost: FrameHook | null = null;

export function setFrameHooks(pre: FrameHook | null, post: FrameHook | null): void {
    _onFramePre = pre;
    _onFramePost = post;
}

export function callFramePre(timestamp: number): void {
    _onFramePre?.(timestamp);
}

export function callFramePost(timestamp: number): void {
    _onFramePost?.(timestamp);
}
