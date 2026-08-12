/**
 * heaters — pure helpers for `heater_generic <name>` Klipper objects.
 *
 * Anything that is not `extruder*` or `heater_bed` but still has a settable
 * target is a `heater_generic`: the active chamber, a filament dryer, and
 * whatever else a vendor wired up. Its name is chosen by the printer's own
 * config, so it differs per vendor — Protype's CD400 ships `Active_Chamber`
 * and `Drying_Chamber_N`, other firmwares (Qidi among them) use their own
 * spelling. Hardcoding one vendor's names is why a chamber could read 0 cards
 * on a printer that plainly has one, so the names are discovered from
 * `printer.objects.list` and classified here instead.
 */
import type { GenericHeaterKind, GenericHeaterState, HeaterState } from './types';

const GENERIC_HEATER_PREFIX = 'heater_generic ';

/** Slots the temperature panel renders; null means "this printer has none". */
export interface GenericHeaterSlots {
  heaterChamber: HeaterState | null;
  dryingChamber1: HeaterState | null;
  dryingChamber2: HeaterState | null;
}

export function isGenericHeaterKey(key: string): boolean {
  return key.startsWith(GENERIC_HEATER_PREFIX) && key.length > GENERIC_HEATER_PREFIX.length;
}

/** Bare config name: "heater_generic Active_Chamber" → "Active_Chamber". */
export function genericHeaterLabel(name: string): string {
  return name.startsWith(GENERIC_HEATER_PREFIX)
    ? name.slice(GENERIC_HEATER_PREFIX.length)
    : name;
}

/** Pick the generic heaters out of a printer.objects.list result. */
export function discoverGenericHeaterObjects(names: string[]): string[] {
  return names.filter(isGenericHeaterKey);
}

/**
 * Guess a heater's role from its config name.
 *
 * Dryer is tested first on purpose: `Drying_Chamber_1` carries *both* tokens,
 * and letting "chamber" win would park every dryer in the single chamber slot
 * and hide the real chamber behind it.
 */
export function classifyGenericHeater(label: string): GenericHeaterKind {
  const normalized = label.toLowerCase().replace(/[_-]+/g, ' ');
  // `box` covers QIDI's dry box (`heater_box1`), confirmed on a live X-Max 4 by
  // the firmware's own `multi_color_controller.drying.box1`, its
  // `prepare_filament_dry` macro and per-material `box_min_temp/box_max_temp`.
  if (normalized.includes('dry') || normalized.includes('box')) return 'dryer';
  if (normalized.includes('chamber') || normalized.includes('enclosure')) return 'chamber';
  return 'other';
}

/** Extract generic heaters from a full or partial status object. */
export function parseGenericHeaters(status: Record<string, any>): GenericHeaterState[] {
  const out: GenericHeaterState[] = [];
  for (const [key, val] of Object.entries(status)) {
    if (!isGenericHeaterKey(key) || !val || typeof val !== 'object') continue;
    // Same bar as parseHeater: no temperature means Klipper is not reporting
    // this object as a heater, and a 0 °C card would be a lie. A queried but
    // absent object comes back as `{}`, and that is the shape this drops.
    if (typeof (val as any).temperature === 'undefined') continue;
    const label = genericHeaterLabel(key);
    out.push({
      name: key,
      label,
      kind: classifyGenericHeater(label),
      temperature: Number((val as any).temperature ?? 0),
      target: Number((val as any).target ?? 0),
      power: Number((val as any).power ?? 0),
    });
  }
  return out;
}

/**
 * Map discovered heaters onto the panel's fixed slots.
 *
 * Dryers are ordered numerically by name so `Drying_Chamber_2` cannot take
 * slot 1 just because it was discovered first (and `_10` sorts after `_2`).
 * An `other` heater never fills the chamber slot — mislabelling it as the
 * chamber would feed a wrong reading to calibration and bed compensation.
 */
export function genericHeaterSlots(heaters: GenericHeaterState[]): GenericHeaterSlots {
  const picks = pickSlots(heaters);
  return {
    heaterChamber: toHeaterState(picks.heaterChamber),
    dryingChamber1: toHeaterState(picks.dryingChamber1),
    dryingChamber2: toHeaterState(picks.dryingChamber2),
  };
}

/**
 * The bare Klipper heater name behind a slot, for `SET_HEATER_TEMPERATURE`.
 *
 * Reading and writing must resolve through the same pick, or the panel shows
 * one printer's chamber while the setter addresses another vendor's name.
 */
export function genericHeaterName(
  heaters: GenericHeaterState[],
  slot: keyof GenericHeaterSlots,
): string | null {
  return genericHeaterForSlot(heaters, slot)?.label ?? null;
}

/**
 * The whole heater behind a slot — `.label` for G-code, `.name` for anything
 * keyed by the Klipper object (Moonraker's temperature store, subscriptions).
 */
export function genericHeaterForSlot(
  heaters: GenericHeaterState[],
  slot: keyof GenericHeaterSlots,
): GenericHeaterState | null {
  return pickSlots(heaters)[slot] ?? null;
}

/**
 * Slot → full Klipper object name, resolved from names alone.
 *
 * For anything keyed by object name that carries no readings to parse —
 * Moonraker's `/server/temperature_store`, an objects.list result.
 */
export function genericHeaterSlotNames(
  names: string[],
): Record<keyof GenericHeaterSlots, string | null> {
  const heaters: GenericHeaterState[] = discoverGenericHeaterObjects(names).map((name) => {
    const label = genericHeaterLabel(name);
    return { name, label, kind: classifyGenericHeater(label), temperature: 0, target: 0, power: 0 };
  });
  const picks = pickSlots(heaters);
  return {
    heaterChamber: picks.heaterChamber?.name ?? null,
    dryingChamber1: picks.dryingChamber1?.name ?? null,
    dryingChamber2: picks.dryingChamber2?.name ?? null,
  };
}

/** Which heater owns each slot — the one place slot order is decided. */
function pickSlots(
  heaters: GenericHeaterState[],
): Record<keyof GenericHeaterSlots, GenericHeaterState | undefined> {
  const ofKind = (kind: GenericHeaterKind) =>
    heaters
      .filter((h) => h.kind === kind)
      .sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }));

  const chambers = ofKind('chamber');
  const dryers = ofKind('dryer');

  return {
    heaterChamber: chambers[0],
    dryingChamber1: dryers[0],
    dryingChamber2: dryers[1],
  };
}

function toHeaterState(h: GenericHeaterState | undefined): HeaterState | null {
  if (!h) return null;
  return { temperature: h.temperature, target: h.target, power: h.power };
}
