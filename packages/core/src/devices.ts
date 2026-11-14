/** Preview devices for the prototype player. `screen` is the suggested frame size in px. */
export type DeviceKind = 'phone' | 'tablet' | 'laptop' | 'browser';
export interface DeviceSpec { id: string; label: string; group: 'Phone' | 'Tablet' | 'Laptop' | 'Desktop'; kind: DeviceKind; screen: { w: number; h: number }; bezel: number; radius: number; camera: 'island' | 'notch' | 'punch' | 'none' | 'home-button' }

export const DEVICES: DeviceSpec[] = [
  { id: 'IPHONE_16_PRO', label: 'iPhone 16 Pro', group: 'Phone', kind: 'phone', screen: { w: 402, h: 874 }, bezel: 10, radius: 52, camera: 'island' },
  { id: 'IPHONE_16', label: 'iPhone 16', group: 'Phone', kind: 'phone', screen: { w: 393, h: 852 }, bezel: 10, radius: 50, camera: 'island' },
  { id: 'IPHONE_SE', label: 'iPhone SE', group: 'Phone', kind: 'phone', screen: { w: 375, h: 667 }, bezel: 12, radius: 26, camera: 'home-button' },
  { id: 'PIXEL_9', label: 'Google Pixel 9', group: 'Phone', kind: 'phone', screen: { w: 412, h: 915 }, bezel: 9, radius: 40, camera: 'punch' },
  { id: 'GALAXY_S24', label: 'Samsung Galaxy S24', group: 'Phone', kind: 'phone', screen: { w: 360, h: 780 }, bezel: 8, radius: 36, camera: 'punch' },
  { id: 'IPAD_PRO_11', label: 'iPad Pro 11"', group: 'Tablet', kind: 'tablet', screen: { w: 834, h: 1194 }, bezel: 16, radius: 34, camera: 'none' },
  { id: 'IPAD_MINI', label: 'iPad mini', group: 'Tablet', kind: 'tablet', screen: { w: 744, h: 1133 }, bezel: 16, radius: 30, camera: 'none' },
  { id: 'GALAXY_TAB', label: 'Samsung Galaxy Tab', group: 'Tablet', kind: 'tablet', screen: { w: 800, h: 1280 }, bezel: 14, radius: 24, camera: 'none' },
  { id: 'MACBOOK_PRO_14', label: 'MacBook Pro 14"', group: 'Laptop', kind: 'laptop', screen: { w: 1512, h: 982 }, bezel: 14, radius: 14, camera: 'notch' },
  { id: 'BROWSER', label: 'Desktop browser', group: 'Desktop', kind: 'browser', screen: { w: 1440, h: 900 }, bezel: 0, radius: 10, camera: 'none' },
];
/** Older files stored `PHONE` / `DESKTOP`. */
const LEGACY: Record<string, string> = { PHONE: 'IPHONE_16', DESKTOP: 'BROWSER' };
export const deviceSpec = (id: string | undefined): DeviceSpec | null => { if (!id || id === 'NONE') return null; const k = LEGACY[id] ?? id; return DEVICES.find(d => d.id === k) ?? null; };
