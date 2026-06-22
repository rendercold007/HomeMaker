/**
 * Display-only unit formatting. Internal world units are centimeters; convert
 * to human-readable strings ONLY at display time (see CLAUDE.md).
 */

const CM_PER_INCH = 2.54;
const CM_PER_FOOT = 30.48;

/** Format a length in cm as feet-inches, e.g. 305 -> `10' 0"`. */
export function cmToFeetInches(cm: number): string {
  const totalInches = Math.round(cm / CM_PER_INCH);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${feet}' ${inches}"`;
}

/** Format a length in cm as meters with two decimals, e.g. 305 -> `3.05 m`. */
export function cmToMeters(cm: number): string {
  return `${(cm / 100).toFixed(2)} m`;
}

/** Default readout used while drawing: feet-inches (Indian residential norm). */
export function formatLength(cm: number): string {
  return cmToFeetInches(cm);
}

/** Format an area in cm² as square feet, e.g. 92903 -> `100 sq ft`. */
export function formatArea(cm2: number): string {
  const sqFt = cm2 / (CM_PER_FOOT * CM_PER_FOOT);
  return `${Math.round(sqFt)} sq ft`;
}
