/**
 * Event ingestion and routing. Schema in M0; polling sources and the router land in M3.
 * Routing is deterministic first (thread id + sender in the goal's participants); a model may
 * only *link* an ambiguous event to a goal, never act on it.
 */
export interface NormalizedEvent {
  source: string;
  externalId: string;
  type: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
}

export interface EventSource {
  poll(connectionId: string): Promise<NormalizedEvent[]>;
}

export interface EventRoute {
  goalId: string;
  expectationId?: string;
}

export interface EventRouter {
  route(userId: string, event: NormalizedEvent): Promise<EventRoute[]>;
}
