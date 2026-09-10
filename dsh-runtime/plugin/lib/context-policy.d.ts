export const TOOL_PREVIEW_CHARS: number;
export const TOOL_RECEIPT_CHARS: number;
export const TOOL_READ_CHARS: number;
export function pruneToolResults(session: any, tokenMeter: any): { pruned: number; charsRemoved: number };
export function readToolResult(session: any, args: { call_id: string; offset?: number; find?: string }): {
  call_id: string;
  is_error?: boolean;
  total_chars: number;
  found?: false;
  offset?: number;
  next_offset: number | null;
  text: string;
};
export function installContextPolicy(agentCtx: any, tokenMeter: any): void;
