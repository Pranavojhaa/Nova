/**
 * Context Engine: the minimal relevant slice of the Brain and goal state for one turn.
 * Interface only in M0.
 */
export interface UntrustedContent {
  /** Where it came from, e.g. 'email:<message id>'. */
  source: string;
  /** Delimited as data in the prompt. Defense in depth only; recipient pinning is the real control. */
  text: string;
}

export interface ContextPacket {
  now: string;
  userTimezone: string;
  goal: { id: string; intent: string; outcomeSpec: unknown; status: string };
  tasks: Array<{ id: string; title: string; status: string }>;
  participants: Array<{ entityId: string; displayName: string; emails: string[] }>;
  capabilities: Array<{ name: string; risk: string; inputSchema: unknown }>;
  activeEnvelope: { version: number; summary: string } | null;
  trigger: { type: string; payload: unknown } | null;
  untrusted: UntrustedContent[];
}

export interface ContextEngine {
  build(goalId: string, triggerEventId: string | null): Promise<ContextPacket>;
}
