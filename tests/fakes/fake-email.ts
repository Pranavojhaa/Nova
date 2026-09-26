import { z } from 'zod';
import {
  NotPerformedError,
  type Capability,
  type DispatchResult,
  type ExecutionContext,
} from '../../src/modules/capabilities/index.js';

const Input = z.object({
  to: z.array(z.email()).min(1),
  subject: z.string(),
  body: z.string(),
  threadId: z.string().optional(),
});
type Input = z.infer<typeof Input>;

export type FailureMode =
  | 'none'
  /** Provider rejects before doing anything. */
  | 'reject_retryable'
  | 'reject_permanent'
  /** Provider sends, then the response is lost (timeout). The dangerous case. */
  | 'send_then_timeout'
  /** Request never reaches the provider, but the client can't tell. */
  | 'timeout_without_send';

export interface SentMessage {
  id: string;
  actionId: string;
  to: string[];
  subject: string;
  body: string;
}

/**
 * In-memory email provider implementing the real capability contract. Stamps the Nova
 * action id on each message (as Gmail will via a header) so reconcile can look it up.
 */
export class FakeEmail implements Capability<Input> {
  readonly name = 'email.send';
  readonly risk = 'communicate_external' as const;
  readonly input = Input;

  readonly sent: SentMessage[] = [];
  failures: FailureMode[] = [];
  reconcileUnavailable = false;
  verifyMode: 'normal' | 'pending' | 'missing' = 'normal';
  private seq = 0;

  externalTargets(input: Input): string[] {
    return input.to.map((a) => a.trim().toLowerCase());
  }

  permitAllows(input: Input, constraints: Record<string, unknown>): boolean {
    const threadId = constraints['threadId'];
    return threadId === undefined || threadId === input.threadId;
  }

  dispatch(input: Input, ctx: ExecutionContext): Promise<DispatchResult> {
    const mode = this.failures.shift() ?? 'none';
    switch (mode) {
      case 'reject_retryable':
        return Promise.reject(new NotPerformedError('rate limited', true));
      case 'reject_permanent':
        return Promise.reject(new NotPerformedError('invalid recipient', false));
      case 'timeout_without_send':
        return Promise.reject(new Error('ETIMEDOUT'));
      case 'send_then_timeout':
        this.store(input, ctx);
        return Promise.reject(new Error('ETIMEDOUT'));
      case 'none':
        return Promise.resolve({ provider: 'fake-email', providerRef: this.store(input, ctx).id });
    }
  }

  reconcile(_input: Input, ctx: ExecutionContext) {
    if (this.reconcileUnavailable) return Promise.reject(new Error('provider unavailable'));
    const msg = this.sent.find((m) => m.actionId === ctx.actionId);
    return Promise.resolve(
      msg
        ? { found: true as const, result: { provider: 'fake-email', providerRef: msg.id } }
        : { found: false as const },
    );
  }

  verify(input: Input, ctx: ExecutionContext, result: DispatchResult) {
    if (this.verifyMode === 'pending')
      return Promise.resolve({ status: 'pending' as const, evidence: {} });
    const msg =
      this.verifyMode === 'missing'
        ? undefined
        : this.sent.find((m) => m.id === result.providerRef);
    const ok =
      msg !== undefined &&
      msg.actionId === ctx.actionId &&
      msg.subject === input.subject &&
      msg.body === input.body;
    return Promise.resolve({
      status: ok ? ('verified' as const) : ('failed' as const),
      evidence: { found: msg !== undefined },
    });
  }

  sendsFor(actionId: string): number {
    return this.sent.filter((m) => m.actionId === actionId).length;
  }

  private store(input: Input, ctx: ExecutionContext): SentMessage {
    const msg = {
      id: `msg_${++this.seq}`,
      actionId: ctx.actionId,
      to: input.to,
      subject: input.subject,
      body: input.body,
    };
    this.sent.push(msg);
    return msg;
  }
}
