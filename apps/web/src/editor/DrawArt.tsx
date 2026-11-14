/** Illustrated 3D-style tool art for the dock's draw mode (pen nib, brush, pencil). Tips point up; the dock crops the bottoms. */
const W = 44, H = 64;
const svg = (children: React.ReactNode, id: string) => (
  <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>{children}
    <defs>
      <linearGradient id={`${id}m`} x1="0" x2="1"><stop offset="0" stopColor="#6d6d72" /><stop offset=".35" stopColor="#e9e9ec" /><stop offset=".6" stopColor="#b9b9be" /><stop offset="1" stopColor="#5c5c61" /></linearGradient>
      <linearGradient id={`${id}d`} x1="0" x2="1"><stop offset="0" stopColor="#3b3b3f" /><stop offset=".4" stopColor="#8a8a90" /><stop offset="1" stopColor="#323236" /></linearGradient>
      <linearGradient id={`${id}w`} x1="0" x2="1"><stop offset="0" stopColor="#a9a9ad" /><stop offset=".45" stopColor="#f5f5f6" /><stop offset="1" stopColor="#9a9a9f" /></linearGradient>
    </defs>
  </svg>
);
export function PenArt() {
  return svg(<>
    <path d="M22 3C26 12 33 22 33 33c0 4-2 8-3 10H14c-1-2-3-6-3-10C11 22 18 12 22 3z" fill="url(#pnm)" stroke="#2e2e32" strokeWidth="1" />
    <path d="M22 20v14" stroke="#3b3b3f" strokeWidth="1.2" strokeLinecap="round" />
    <circle cx="22" cy="31" r="3.2" fill="#f4f4f6" stroke="#4a4a50" strokeWidth="1" />
    <path d="M14 43h16l1 4H13z" fill="url(#pnd)" />
    <rect x="12" y="47" width="20" height="6" rx="1.500" fill="url(#pnw)" stroke="#555" strokeWidth=".8" />
    <rect x="12" y="55" width="20" height="14" rx="3" fill="url(#pnd)" />
  </>, 'pn');
}
export function BrushArt() {
  return svg(<>
    <path d="M7 24c0-9 4-17 8-18 2 3 5-2 8 1 3-3 7-1 8 2 3 0 6 8 6 15z" fill="url(#brw)" stroke="#8c8c92" strokeWidth="1" />
    <path d="M12 18c2 2 3 4 3 7M20 14c1 3 1 7 0 10M28 16c-1 3-1 6 0 9M34 20c-1 2-2 4-2 5" stroke="#bdbdc2" strokeWidth="1" fill="none" strokeLinecap="round" />
    <rect x="6" y="24" width="32" height="15" rx="3" fill="url(#brm)" stroke="#55555a" strokeWidth=".8" />
    <path d="M6 29h32M6 34h32" stroke="#6c6c71" strokeWidth=".8" />
    <rect x="12" y="39" width="20" height="30" rx="4" fill="url(#brd)" />
  </>, 'br');
}
export function PencilArt() {
  return svg(<>
    <path d="M22 3l11 21H11z" fill="url(#pcw)" stroke="#8c8c92" strokeWidth="1" />
    <path d="M22 3l-3.600 6.800h7.200z" fill="url(#pcd)" />
    <path d="M11 24h22v26H11z" fill="url(#pcd)" />
    <path d="M11 24c3 3 5-2 8 1s4-2 7 0 5 2 7-1" stroke="#c9c9ce" strokeWidth="1" fill="none" />
    <rect x="11" y="50" width="22" height="7" fill="url(#pcm)" stroke="#555" strokeWidth=".8" />
    <rect x="11" y="57" width="22" height="12" rx="3" fill="url(#pcw)" stroke="#8c8c92" strokeWidth=".8" />
  </>, 'pc');
}
