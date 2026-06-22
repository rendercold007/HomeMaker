/**
 * Furniture catalog — pure data, no React imports.
 *
 * Each entry defines a furniture type's display name, default footprint (cm),
 * and fill color for the plan view. Indian-home essentials come first.
 */

export interface FurnitureDef {
  type: string;
  label: string;
  /** Footprint width in cm (along X before rotation). */
  widthCm: number;
  /** Footprint depth in cm (along Y before rotation). */
  heightCm: number;
  /** Fill color for the plan rectangle. */
  color: string;
}

export const FURNITURE_CATALOG: readonly FurnitureDef[] = [
  { type: 'double_bed',      label: 'Double Bed',    widthCm: 150, heightCm: 195, color: '#bfdbfe' },
  { type: 'single_bed',      label: 'Single Bed',    widthCm:  90, heightCm: 195, color: '#bfdbfe' },
  { type: 'sofa',            label: 'Sofa',          widthCm: 210, heightCm:  90, color: '#fed7aa' },
  { type: 'pooja_unit',      label: 'Pooja Unit',    widthCm:  90, heightCm:  45, color: '#fef3c7' },
  { type: 'dining_table',    label: 'Dining Table',  widthCm: 120, heightCm:  75, color: '#d1fae5' },
  { type: 'wardrobe',        label: 'Wardrobe',      widthCm: 120, heightCm:  60, color: '#e0e7ff' },
  { type: 'tv_unit',         label: 'TV Unit',       widthCm: 150, heightCm:  40, color: '#f1f5f9' },
  { type: 'kitchen_counter', label: 'Kitchen',       widthCm:  60, heightCm:  60, color: '#fce7f3' },
  { type: 'toilet',          label: 'WC',            widthCm:  40, heightCm:  60, color: '#ecfdf5' },
  { type: 'wash_basin',      label: 'Wash Basin',    widthCm:  50, heightCm:  40, color: '#ecfdf5' },
];

export function getFurnitureDef(type: string): FurnitureDef | undefined {
  return FURNITURE_CATALOG.find((f) => f.type === type);
}
