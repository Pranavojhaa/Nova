import { pino, type DestinationStream, type Logger } from 'pino';

export type { Logger };

/** Paths that must never reach logs, even at trace level. */
export const REDACT_PATHS = [
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.tokenCiphertext',
  '*.password',
  '*.secret',
  '*.authorization',
  'req.headers.authorization',
  'req.headers.cookie',
  'config.NOVA_MASTER_KEY',
  'config.DATABASE_URL',
];

export function createLogger(level: string, destination?: DestinationStream): Logger {
  return pino({ level, redact: { paths: REDACT_PATHS, censor: '[redacted]' } }, destination);
}
