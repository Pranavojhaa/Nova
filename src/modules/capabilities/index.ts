/**
 * Capabilities are provider-agnostic (`email.send`, `calendar.create_event`); provider adapters
 * such as Gmail implement them. No real providers exist in M0; tests use fakes in tests/fakes.
 */
export * from './types.js';
export { CapabilityRegistry } from './registry.js';
