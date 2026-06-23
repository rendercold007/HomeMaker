/**
 * Room type metadata — labels and floor colors. Pure data, no React imports.
 *
 * The colors are muted, warm interior tones so a kitchen reads as a kitchen in
 * the 3D view rather than a random hue.
 */
import type { RoomType } from './types';

export interface RoomTypeDef {
  type: RoomType;
  label: string;
  /** Floor color in the 3D view. */
  color: string;
}

export const ROOM_TYPES: readonly RoomTypeDef[] = [
  { type: 'living',   label: 'Living',   color: '#c8b89a' },
  { type: 'bedroom',  label: 'Bedroom',  color: '#b5b1c4' },
  { type: 'kitchen',  label: 'Kitchen',  color: '#c4b59a' },
  { type: 'bathroom', label: 'Bathroom', color: '#a9c2cc' },
  { type: 'dining',   label: 'Dining',   color: '#b8c4b1' },
  { type: 'study',    label: 'Study',    color: '#c0b4a8' },
  { type: 'utility',  label: 'Utility',  color: '#b2bec3' },
  { type: 'pooja',    label: 'Pooja',    color: '#d4c08a' },
  { type: 'parking',  label: 'Parking',  color: '#a8a8a8' },
  { type: 'other',    label: 'Other',    color: '#bdb3a3' },
];

const DEFAULT_COLOR = '#bdb3a3';

export function roomTypeColor(type: RoomType): string {
  return ROOM_TYPES.find((t) => t.type === type)?.color ?? DEFAULT_COLOR;
}

export function roomTypeLabel(type: RoomType): string {
  return ROOM_TYPES.find((t) => t.type === type)?.label ?? 'Other';
}
