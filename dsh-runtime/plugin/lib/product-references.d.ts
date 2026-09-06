export interface BeesReference { namespace?: string; label: string; kind: string; id: string }
export function referenceSlug(value: unknown): string;
export function referenceText(reference: BeesReference): string;
export function typedReferences(value: string): BeesReference[];
export function resolveReferences(database: any, workspaceId: string, text: string): { text: string; references: BeesReference[] };
export function resolveReference(database: any, workspaceId: string, kind: string, value: string, byId?: boolean): any;
export function authorizeReferences(database: any, workspaceId: string, references: BeesReference[]): void;
export function referenceInputs(database: any, workspaceId: string, references: BeesReference[]): any[];
export function referenceRows(database: any, workspaceId: string): any[];
export function fileReferences(database: any, workspaceId: string, query: string): BeesReference[];
export function referenceContext(database: any, workspaceId: string, references: BeesReference[]): string;
export function preserveReferences(text: string, references: BeesReference[]): string;
export function leadingAgentInvocation(text: string): { agents: Array<{ id: string; name: string }>; request: string; reference: string } | null;
