import { z } from 'zod';

/**
 * All configuration comes from the environment and is validated once at startup.
 * Secrets are read here and nowhere else; never log the returned object.
 */

/** Comma-separated addresses, normalised to trimmed lowercase. Empty is an error, never "no restriction". */
const EmailList = z
  .string()
  .transform((s) =>
    s
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter((x) => x.length > 0),
  )
  .pipe(z.array(z.email()).min(1, 'must list at least one address'));

const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    /** Which deployment this is. Separate from NODE_ENV: staging also runs NODE_ENV=production. */
    NOVA_ENV: z.enum(['dev', 'staging', 'prod']).default('dev'),
    /** Git SHA baked into the image at build time. */
    NOVA_RELEASE: z.string().min(1).default('local'),
    /** Outside prod, the only addresses Nova may target. Required in dev and staging. */
    NOVA_RECIPIENT_ALLOWLIST: EmailList.optional(),
    DATABASE_URL: z.url(),
    API_PORT: z.coerce.number().int().positive().default(3000),
    /** When set, the worker serves liveness on this port (Cloud Run needs a listening port). */
    HEALTH_PORT: z.coerce.number().int().positive().optional(),
    NOVA_MASTER_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded'),
  })
  .superRefine((c, ctx) => {
    if (c.NOVA_ENV !== 'prod' && c.NOVA_RECIPIENT_ALLOWLIST === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['NOVA_RECIPIENT_ALLOWLIST'],
        message: `required when NOVA_ENV=${c.NOVA_ENV}`,
      });
    }
  });

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    // Report which keys are wrong, never their values.
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n  ${problems.join('\n  ')}`);
  }
  return parsed.data;
}
