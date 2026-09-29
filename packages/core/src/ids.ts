import { z } from 'zod';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Identifier of a single object inside a project (Koma, element, asset, ...). */
export const idSchema = z
  .string()
  .regex(ID_PATTERN, 'Identifier must be 1-64 characters: letters, digits, "_" or "-"');

/**
 * Identity of a visual object across Komas. Two elements in different Komas
 * that share a `persistentId` are the same object in two visual states.
 */
export const persistentIdSchema = idSchema;

export function isValidId(value: string): boolean {
  return ID_PATTERN.test(value);
}

export interface IdGenerator {
  /**
   * Returns a new identifier. When `key` is given, a seeded generator derives
   * the identifier from it so the result does not depend on call order.
   */
  next(prefix: string, key?: string): string;
}

/**
 * The core package loads neither DOM nor Node.js type libraries. Web Crypto
 * exists in every runtime Koma Motion supports (Node.js 22+, Electron and
 * browsers), so its one required function is described here.
 */
interface RandomUuidSource {
  randomUUID(): string;
}

function getRandomUuidSource(): RandomUuidSource {
  const source = (globalThis as { readonly crypto?: RandomUuidSource }).crypto;
  if (source === undefined) {
    throw new Error('Web Crypto is not available in this runtime');
  }
  return source;
}

export function createRandomIdGenerator(): IdGenerator {
  const source = getRandomUuidSource();
  return {
    next(prefix) {
      return `${prefix}_${source.randomUUID().replaceAll('-', '').slice(0, 16)}`;
    },
  };
}

function hashRound(input: string, seed: number): [number, number] {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return [h1 >>> 0, h2 >>> 0];
}

/** Deterministic, non-cryptographic string hash (cyrb53 mixing) as 16 hex characters. */
export function hashString(input: string): string {
  const [h1, h2] = hashRound(input, 0);
  return `${h2.toString(16).padStart(8, '0')}${h1.toString(16).padStart(8, '0')}`;
}

/** Produces the same identifiers for the same seed and the same sequence of requests. */
export function createSeededIdGenerator(seed: string): IdGenerator {
  const issued = new Map<string, number>();
  let counter = 0;
  return {
    next(prefix, key) {
      const base = key ?? `#${String(counter++)}`;
      const scope = `${prefix}/${base}`;
      const repeat = issued.get(scope) ?? 0;
      issued.set(scope, repeat + 1);
      return `${prefix}_${hashString(`${seed}/${scope}/${String(repeat)}`)}`;
    },
  };
}
