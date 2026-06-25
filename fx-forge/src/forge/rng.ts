//---------------------------------------------------
//
//  Seeded PRNG
//
//  Deterministic randomness so a (seed + recipe) pair always reproduces the
//  exact same pattern. No Math.random() anywhere in the engine.
//
//---------------------------------------------------

/** mulberry32 — tiny, fast, good-enough 32-bit PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Combine a base seed with a sub-stream id (e.g. a track index) deterministically. */
export function mixSeed(seed: number, stream: number): number {
  return Math.imul((seed ^ (stream + 1)) >>> 0, 2654435761) >>> 0;
}

export class Rng {
  private next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed >>> 0);
  }

  /** Float in [0, 1). */
  float(): number {
    return this.next();
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** True with probability p (0..1). */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Bipolar value in [-1, 1). */
  bipolar(): number {
    return this.next() * 2 - 1;
  }

  /** Pick a random element. */
  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)];
  }
}
