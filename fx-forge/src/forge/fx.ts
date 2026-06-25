//---------------------------------------------------
//
//  FX helpers
//
//  Thin layer over tracker-lib's PatternFX table. Lets the engine address
//  effects by symbol or name, and convert user-facing "scaled" values
//  (e.g. -50..+50 panning) to the raw values actually stored in the .mtp.
//
//---------------------------------------------------
import { PatternFX, type FXRecord, type FX } from '@polyend/tracker-lib';

//----------------------------------
// Lookups
//----------------------------------
// Some symbols are reused across records (e.g. 'x'); name is the unique key.
const BY_NAME = new Map<string, FXRecord>();
const BY_SYMBOL = new Map<string, FXRecord>();

for (const rec of PatternFX) {
  BY_NAME.set(rec.name.toLowerCase(), rec);
  if (!BY_SYMBOL.has(rec.symbol)) {
    BY_SYMBOL.set(rec.symbol, rec);
  }
}

/** The "None" record (index 0) — an empty FX lane. */
export const NONE: FXRecord = PatternFX[0];

/** Resolve an FX record by its single-char symbol (e.g. 'C') or full name (e.g. 'Chance'). */
export function fxRecord(symbolOrName: string): FXRecord {
  const rec = symbolOrName.length === 1 ? BY_SYMBOL.get(symbolOrName) : BY_NAME.get(symbolOrName.toLowerCase());
  if (!rec) {
    throw new Error(`Unknown FX: "${symbolOrName}"`);
  }
  return rec;
}

//----------------------------------
// Value helpers
//----------------------------------
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Convert a user-facing scaled value into the raw value stored in the pattern.
 * Records without a `scaled` range store the value as-is (just clamped).
 *
 * e.g. Panning (raw 0..100, scaled -50..50): scaledToRaw('P', 0) === 50 (center).
 */
export function scaledToRaw(rec: FXRecord, scaledValue: number): number {
  if (!rec.scaled) {
    return Math.round(clamp(scaledValue, rec.min, rec.max));
  }
  const { min: smin, max: smax } = rec.scaled;
  const t = (scaledValue - smin) / (smax - smin);
  const raw = rec.min + t * (rec.max - rec.min);
  return Math.round(clamp(raw, rec.min, rec.max));
}

//----------------------------------
// FX construction
//----------------------------------
export interface FxOptions {
  /** Treat `value` as a user-facing scaled value (e.g. cents, BPM, L/R pan). */
  scaled?: boolean;
}

/**
 * Build a fresh FX lane object. The record is cloned so every step owns its own
 * FXRecord instance (the editor relies on this — it mutates `.value` per step).
 */
export function makeFx(symbolOrName: string, value: number, opts: FxOptions = {}): FX {
  const rec = fxRecord(symbolOrName);
  const raw = opts.scaled ? scaledToRaw(rec, value) : Math.round(clamp(value, rec.min, rec.max));
  return { type: structuredClone(rec), value: raw };
}

/** An empty FX lane. */
export function makeNone(): FX {
  return { type: structuredClone(NONE), value: 0 };
}
