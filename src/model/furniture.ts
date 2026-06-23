/**
 * Furniture catalog — pure data, no React imports.
 *
 * Each entry defines a furniture type's display name, default footprint (cm),
 * and fill color for the plan view, grouped by room.
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
  // Bedroom
  { type: 'double_bed',      label: 'Double Bed',    widthCm: 150, heightCm: 195, color: '#bfdbfe' },
  { type: 'single_bed',      label: 'Single Bed',    widthCm:  90, heightCm: 195, color: '#bfdbfe' },
  { type: 'wardrobe',        label: 'Wardrobe',      widthCm: 120, heightCm:  60, color: '#e0e7ff' },
  { type: 'side_table',      label: 'Side Table',    widthCm:  45, heightCm:  45, color: '#e0e7ff' },

  // Living
  { type: 'sofa',            label: 'Sofa',          widthCm: 210, heightCm:  90, color: '#fed7aa' },
  { type: 'coffee_table',    label: 'Coffee Table',  widthCm: 110, heightCm:  60, color: '#d1fae5' },
  { type: 'tv_unit',         label: 'TV Unit',       widthCm: 150, heightCm:  40, color: '#f1f5f9' },
  { type: 'bookshelf',       label: 'Bookshelf',     widthCm:  90, heightCm:  30, color: '#ede9fe' },

  // Dining
  { type: 'dining_table',    label: 'Dining Table',  widthCm: 120, heightCm:  75, color: '#d1fae5' },
  { type: 'chair',           label: 'Chair',         widthCm:  45, heightCm:  45, color: '#fed7aa' },

  // Kitchen
  { type: 'kitchen_counter', label: 'Counter',       widthCm: 180, heightCm:  60, color: '#fce7f3' },
  { type: 'kitchen_island',  label: 'Island',        widthCm: 120, heightCm:  80, color: '#fce7f3' },
  { type: 'kitchen_sink',    label: 'Kitchen Sink',  widthCm:  80, heightCm:  55, color: '#e0f2fe' },
  { type: 'stove',           label: 'Stove / Hob',   widthCm:  60, heightCm:  60, color: '#fee2e2' },
  { type: 'fridge',          label: 'Refrigerator',  widthCm:  70, heightCm:  70, color: '#dbeafe' },
  { type: 'chimney',         label: 'Chimney',       widthCm:  60, heightCm:  40, color: '#f1f5f9' },

  // Bathroom
  { type: 'toilet',          label: 'WC',              widthCm:  40, heightCm:  60, color: '#ecfdf5' },
  { type: 'wash_basin',      label: 'Wash Basin',      widthCm:  50, heightCm:  40, color: '#ecfdf5' },
  { type: 'vanity',          label: 'Vanity',          widthCm:  90, heightCm:  50, color: '#ecfdf5' },
  { type: 'shower',          label: 'Shower',          widthCm:  90, heightCm:  90, color: '#e0f2fe' },
  { type: 'bathtub',         label: 'Bathtub',         widthCm: 170, heightCm:  75, color: '#e0f2fe' },
  { type: 'mirror',          label: 'Mirror',          widthCm:  60, heightCm:  10, color: '#f1f5f9' },
  { type: 'towel_rail',      label: 'Towel Rail',      widthCm:  60, heightCm:  10, color: '#f1f5f9' },
  { type: 'geyser',          label: 'Geyser',          widthCm:  45, heightCm:  30, color: '#fee2e2' },
  { type: 'washing_machine', label: 'Washing Machine', widthCm:  60, heightCm:  60, color: '#f1f5f9' },

  // Study & misc
  { type: 'desk',            label: 'Desk',          widthCm: 120, heightCm:  60, color: '#e0e7ff' },
  { type: 'pooja_unit',      label: 'Pooja Unit',    widthCm:  90, heightCm:  45, color: '#fef3c7' },
];

export function getFurnitureDef(type: string): FurnitureDef | undefined {
  return FURNITURE_CATALOG.find((f) => f.type === type);
}
