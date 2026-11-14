export interface FramePreset { name: string; w: number; h: number }
export interface PresetGroup { id: string; label: string; items: FramePreset[] }

/** Common device, paper and social sizes (px). Sizes are the usual published values; they are conveniences, not a spec. */
export const FRAME_PRESETS: PresetGroup[] = [
  { id: 'phone', label: 'Phone', items: [
    { name: 'iPhone 16', w: 393, h: 852 }, { name: 'iPhone 16 Pro', w: 402, h: 874 }, { name: 'iPhone 16 Plus', w: 430, h: 932 }, { name: 'iPhone 16 Pro Max', w: 440, h: 956 },
    { name: 'iPhone SE', w: 375, h: 667 }, { name: 'Android Compact', w: 360, h: 800 }, { name: 'Android Large', w: 412, h: 917 } ] },
  { id: 'tablet', label: 'Tablet', items: [
    { name: 'iPad mini 8.3"', w: 744, h: 1133 }, { name: 'iPad Pro 11"', w: 834, h: 1194 }, { name: 'iPad Pro 12.9"', w: 1024, h: 1366 }, { name: 'Surface Pro 8', w: 1440, h: 960 }, { name: 'Android Tablet', w: 1280, h: 800 } ] },
  { id: 'desktop', label: 'Desktop', items: [
    { name: 'MacBook Air', w: 1280, h: 832 }, { name: 'MacBook Pro 14"', w: 1512, h: 982 }, { name: 'MacBook Pro 16"', w: 1728, h: 1117 }, { name: 'Desktop', w: 1440, h: 1024 }, { name: 'Wireframe', w: 1440, h: 1024 }, { name: 'TV', w: 1920, h: 1080 } ] },
  { id: 'presentation', label: 'Presentation', items: [{ name: 'Slide 16:9', w: 1920, h: 1080 }, { name: 'Slide 4:3', w: 1024, h: 768 }] },
  { id: 'watch', label: 'Watch', items: [{ name: 'Apple Watch 46mm', w: 208, h: 248 }, { name: 'Apple Watch 44mm', w: 184, h: 224 }, { name: 'Apple Watch 40mm', w: 162, h: 197 }] },
  { id: 'paper', label: 'Paper', items: [{ name: 'A4', w: 595, h: 842 }, { name: 'A5', w: 420, h: 595 }, { name: 'A6', w: 298, h: 420 }, { name: 'Letter', w: 612, h: 792 }, { name: 'Tabloid', w: 792, h: 1224 }] },
  { id: 'social', label: 'Social media', items: [
    { name: 'X (Twitter) post', w: 1200, h: 675 }, { name: 'X (Twitter) header', w: 1500, h: 500 }, { name: 'Facebook post', w: 1200, h: 630 }, { name: 'Facebook cover', w: 820, h: 312 },
    { name: 'Instagram post', w: 1080, h: 1350 }, { name: 'Instagram story', w: 1080, h: 1920 }, { name: 'Dribbble shot', w: 400, h: 300 }, { name: 'Dribbble shot HD', w: 800, h: 600 }, { name: 'LinkedIn cover', w: 1584, h: 396 } ] },
  { id: 'community', label: 'Community', items: [{ name: 'Plugin icon', w: 128, h: 128 }, { name: 'Plugin cover', w: 1920, h: 1080 }, { name: 'File thumbnail', w: 1600, h: 960 }] },
  { id: 'archive', label: 'Archive', items: [
    { name: 'iPhone 8', w: 375, h: 667 }, { name: 'iPhone 8 Plus', w: 414, h: 736 }, { name: 'iPhone X', w: 375, h: 812 }, { name: 'iPhone 11 Pro Max', w: 414, h: 896 }, { name: 'Android', w: 360, h: 640 },
    { name: 'iPad', w: 768, h: 1024 }, { name: 'Surface Book', w: 1500, h: 1000 }, { name: 'MacBook', w: 1152, h: 700 }, { name: 'Apple Watch 38mm', w: 136, h: 170 }, { name: 'Apple Watch 42mm', w: 156, h: 195 } ] },
];
