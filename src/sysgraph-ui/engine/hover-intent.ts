const NODE_DWELL_MS = 110;
const BACKGROUND_DWELL_MS = 90;

/** Delays neighborhood changes until a pointer has settled on the same target. */
export class HoverIntent {
    private activeNode: number | null = null;
    private candidateNode: number | null = null;
    private candidateSince = 0;

    get active(): number | null { return this.activeNode; }
    get pending(): boolean { return this.candidateNode !== this.activeNode; }

    ready(now: number): boolean {
        const dwell = this.candidateNode === null ? BACKGROUND_DWELL_MS : NODE_DWELL_MS;
        return this.pending && now - this.candidateSince >= dwell;
    }

    observe(node: number | null, now: number): void {
        if (node === this.candidateNode) return;
        this.candidateNode = node;
        this.candidateSince = now;
    }

    /** Returns undefined when no neighborhood change is due; null means clear it. */
    advance(now: number): number | null | undefined {
        if (!this.ready(now)) return undefined;
        this.activeNode = this.candidateNode;
        return this.activeNode;
    }

    activate(node: number | null): void {
        this.activeNode = node;
        this.candidateNode = node;
        this.candidateSince = 0;
    }

    cancelPending(): void {
        this.candidateNode = this.activeNode;
        this.candidateSince = 0;
    }

    reset(): void { this.activate(null); }
}
