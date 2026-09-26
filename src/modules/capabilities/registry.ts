import type { AnyCapability } from './types.js';

export class CapabilityRegistry {
  private readonly byName = new Map<string, AnyCapability>();

  constructor(capabilities: AnyCapability[] = []) {
    for (const c of capabilities) this.register(c);
  }

  register(capability: AnyCapability): void {
    if (this.byName.has(capability.name))
      throw new Error(`capability ${capability.name} already registered`);
    this.byName.set(capability.name, capability);
  }

  get(name: string): AnyCapability | undefined {
    return this.byName.get(name);
  }
}
