import type { ReactNode } from 'react';
import { SHAPE_POLY, type Cap, type Route, type ShapeKind } from '@layr/core';

const ic = (body: ReactNode) => (p: { size?: number }) => (
  <svg width={p.size ?? 20} height={p.size ?? 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{body}</svg>
);
export const JI = {
  select: ic(<path d="M5 3l14 7-6 2-2 6z" />),
  hand: ic(<><path d="M8.5 12V6a1.4 1.4 0 012.8 0v5M11.3 5a1.4 1.4 0 012.8 0v6M14.1 6.5a1.4 1.4 0 012.8 0V13c0 3.8-2.3 6-5.6 6-2.2 0-3.6-.9-4.8-2.7L5 13.500a1.400 1.400 0 012.300-1.600l1.200 1.600" /></>),
  section: ic(<><path d="M3 9h8V6.500A1.500 1.500 0 009.500 5h-5A1.500 1.500 0 003 6.500z" /><rect x="3" y="9" width="18" height="11" rx="2" /></>),
  sticky: ic(<><path d="M6 4h12a2 2 0 012 2v8l-6 6H6a2 2 0 01-2-2V6a2 2 0 012-2z" /><path d="M20 14h-4a2 2 0 00-2 2v4" /><path d="M8 9h8M8 13h3.500" /></>),
  text: ic(<path d="M5 6V4.500h14V6M12 4.500V20M9 20h6" />),
  shape: ic(<><rect x="3.500" y="10" width="10" height="10" rx="1.500" /><circle cx="15.500" cy="8.500" r="5" /></>),
  connector: ic(<><path d="M5 19c0-8 6-4 6-9s3-5 8-5" /><path d="M16 2.500L19.500 5 17 8.500" /><circle cx="5" cy="19" r="1.300" /></>),
  pen: ic(<><path d="M4 20l1-4L16.500 4.500a2 2 0 013 3L8 19z" /><path d="M14.500 6.500l3 3" /></>),
  marker: ic(<><path d="M9 14l7.500-8.500a2 2 0 013 3L12 16" /><path d="M9 14l-2.500 1L5 19l4-1.500 1.200-3" /><path d="M13.500 17.500H20" /></>),
  highlighter: ic(<><path d="M15 4l5 5-8 8-5-5z" /><path d="M7 12l-3 6 3 2 4-2" /><path d="M13 20h7" /></>),
  eraser: ic(<><path d="M8.500 19.500H20" /><path d="M5.500 14.500l8.500-9a2 2 0 013 0l2.500 2.500a2 2 0 010 3l-6 6.500H9z" /><path d="M9 20l-3.500-3.500" /></>),
  stamp: ic(<><circle cx="12" cy="12" r="9" /><path d="M8.500 14.500a4.500 4.500 0 007 0" /><path d="M9 9.500h.01M15 9.500h.01" strokeWidth="2.400" /></>),
  table: ic(<><rect x="3" y="4.500" width="18" height="15" rx="2" /><path d="M3 10h18M3 15h18M9 4.500v15M15 4.500v15" /></>),
  code: ic(<><path d="M8.500 7L4 12l4.500 5M15.500 7L20 12l-4.500 5M13.500 5l-3 14" /></>),
  image: ic(<><rect x="3.500" y="4.500" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.700" /><path d="M4 17.500l5-4.500 4 3.500 3-2.500 4.500 3.500" /></>),
  comment: ic(<path d="M20 11.500a7.500 7.500 0 01-10.800 6.700L4 19.500l1.300-4.500A7.500 7.500 0 1120 11.500z" />),
  vote: ic(<><path d="M12 20.500s-7.500-4.600-7.500-10A4.300 4.300 0 0112 7.800a4.300 4.300 0 017.500 2.700c0 5.400-7.500 10-7.500 10z" /></>),
  timer: ic(<><circle cx="12" cy="13.500" r="7.500" /><path d="M12 9.500v4l2.500 1.500M9.500 3h5" /></>),
  link: ic(<><path d="M10 14a4.500 4.500 0 006.400 0l3-3a4.500 4.500 0 00-6.400-6.400l-1 1" /><path d="M14 10a4.500 4.500 0 00-6.400 0l-3 3a4.500 4.500 0 006.400 6.400l1-1" /></>),
  templates: ic(<><rect x="3.500" y="3.500" width="7" height="7" rx="1.500" /><rect x="13.500" y="3.500" width="7" height="7" rx="1.500" /><rect x="3.500" y="13.500" width="7" height="7" rx="1.500" /><rect x="13.500" y="13.500" width="7" height="7" rx="1.500" /></>),
  sectionBox: ic(<><rect x="3.500" y="3.500" width="17" height="17" rx="3" /><rect x="3.500" y="3.500" width="7.500" height="6.500" rx="2" /></>),
  codeDoc: ic(<><rect x="4.500" y="3" width="15" height="18" rx="2.500" /><path d="M9 7.500h.01M14 7.500h.01" strokeWidth="2.400" /><path d="M8 12h8M8 15.500h8" /></>),
  stampTool: ic(<><path d="M12 3.500a3 3 0 00-1.800 5.400c.5.400.8.800.8 1.400V12h2v-1.700c0-.6.300-1 .8-1.400A3 3 0 0012 3.500z" /><path d="M7 12h10a2 2 0 012 2v2H5v-2a2 2 0 012-2z" /><path d="M5 20h14" /></>),
  widgets: ic(<><path d="M7 3.500l3.500 3.500L7 10.500 3.500 7z" /><circle cx="17" cy="7" r="3.500" /><rect x="3.500" y="13.500" width="7" height="7" rx="2" /><path d="M17 13.500v7M13.500 17h7" /></>),
  more: ic(<><circle cx="5.500" cy="12" r="1.200" /><circle cx="12" cy="12" r="1.200" /><circle cx="18.500" cy="12" r="1.200" /></>),
  lock: ic(<><rect x="5" y="10.500" width="14" height="9.500" rx="2" /><path d="M8 10.500V8a4 4 0 018 0v2.500" /></>),
  unlock: ic(<><rect x="5" y="10.500" width="14" height="9.500" rx="2" /><path d="M8 10.500V8a4 4 0 017.500-2" /></>),
  copy: ic(<><rect x="8.500" y="8.500" width="11" height="11" rx="2" /><path d="M15.500 8.500V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7.500a2 2 0 002 2h2.500" /></>),
  edit: ic(<><path d="M4 20h4.500L19.500 9a2.100 2.100 0 000-3L18 4.500a2.100 2.100 0 00-3 0L4 15.500z" /><path d="M13 6.500l4.500 4.500" /></>),
  trash: ic(<><path d="M4.500 7h15M9.500 7V4.500h5V7M6.500 7l.8 12a1.500 1.500 0 001.500 1.500h6.400a1.500 1.500 0 001.500-1.500l.8-12" /></>),
  group: ic(<><rect x="3.500" y="3.500" width="9" height="9" rx="1.500" /><rect x="11.500" y="11.500" width="9" height="9" rx="1.500" /></>),
  front: ic(<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M4 14V6a2 2 0 012-2h8" /></>),
  back: ic(<><rect x="4" y="4" width="12" height="12" rx="2" /><path d="M20 10v8a2 2 0 01-2 2h-8" /></>),
  grid: ic(<><path d="M4 4h16v16H4zM4 12h16M12 4v16" /></>),
  alignL: ic(<><path d="M4 3.500v17" /><rect x="7" y="6" width="12" height="4.500" rx="1" /><rect x="7" y="13.500" width="7" height="4.500" rx="1" /></>),
  alignHC: ic(<><path d="M12 3.500v17" /><rect x="5" y="6" width="14" height="4.500" rx="1" /><rect x="8" y="13.500" width="8" height="4.500" rx="1" /></>),
  alignR: ic(<><path d="M20 3.500v17" /><rect x="5" y="6" width="12" height="4.500" rx="1" /><rect x="10" y="13.500" width="7" height="4.500" rx="1" /></>),
  alignT: ic(<><path d="M3.500 4h17" /><rect x="6" y="7" width="4.500" height="12" rx="1" /><rect x="13.500" y="7" width="4.500" height="7" rx="1" /></>),
  alignVC: ic(<><path d="M3.500 12h17" /><rect x="6" y="5" width="4.500" height="14" rx="1" /><rect x="13.500" y="8" width="4.500" height="8" rx="1" /></>),
  alignB: ic(<><path d="M3.500 20h17" /><rect x="6" y="5" width="4.500" height="12" rx="1" /><rect x="13.500" y="10" width="4.500" height="7" rx="1" /></>),
  distH: ic(<><path d="M4 4v16M20 4v16" /><rect x="9.500" y="7" width="5" height="10" rx="1" /></>),
  distV: ic(<><path d="M4 4h16M4 20h16" /><rect x="7" y="9.500" width="10" height="5" rx="1" /></>),
  bold: ic(<path d="M7 4.500h6a3.500 3.500 0 010 7H7zM7 11.500h7a3.500 3.500 0 010 7H7z" />),
  italic: ic(<path d="M10 4.500h8M6 19.500h8M14.500 4.500l-5 15" />),
  underline: ic(<><path d="M7 4.500v7a5 5 0 0010 0v-7" /><path d="M5 20h14" /></>),
  strike: ic(<><path d="M5 12h14" /><path d="M16.500 7.500a4.500 4.500 0 00-4.500-2.500c-2.500 0-4 1.200-4 3 0 4.500 8.500 2.500 8.500 7 0 1.800-1.800 3-4.500 3a5 5 0 01-4.500-2.500" /></>),
  alignLeft: ic(<path d="M4 6.500h16M4 11h10M4 15.500h16M4 20h10" />),
  alignCenter: ic(<path d="M4 6.500h16M7 11h10M4 15.500h16M7 20h10" />),
  alignRight: ic(<path d="M4 6.500h16M10 11h10M4 15.500h16M10 20h10" />),
  plus: ic(<path d="M12 5v14M5 12h14" />),
  minus: ic(<path d="M5 12h14" />),
  chevD: ic(<path d="M6 9.500l6 6 6-6" />),
  download: ic(<><path d="M12 4v11M7 11l5 5 5-5" /><path d="M5 20h14" /></>),
  share: ic(<><circle cx="6" cy="12" r="2.500" /><circle cx="17.500" cy="6" r="2.500" /><circle cx="17.500" cy="18" r="2.500" /><path d="M8.200 10.800l7.100-3.600M8.200 13.200l7.100 3.600" /></>),
  back2: ic(<path d="M14.500 5.500L8 12l6.500 6.500" />),
  undo: ic(<><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 010 12h-3" /></>),
  redo: ic(<><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 000 12h3" /></>),
  check: ic(<path d="M5 12.500l4.500 4.500L19 7.500" />),
  help: ic(<><circle cx="12" cy="12" r="9" /><path d="M9.500 9.500a2.500 2.500 0 114 2c-.9.6-1.500 1.200-1.500 2.200M12 17h.01" /></>),
  open: ic(<><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h4" /></>),
  rowAdd: ic(<><rect x="3.500" y="4" width="17" height="9" rx="1.500" /><path d="M12 16v5M9.500 18.500h5" /></>),
  colAdd: ic(<><rect x="4" y="3.500" width="9" height="17" rx="1.500" /><path d="M16 12h5M18.500 9.500v5" /></>),
  rowDel: ic(<><rect x="3.500" y="4" width="17" height="9" rx="1.500" /><path d="M9.500 18.500h5" /></>),
  colDel: ic(<><rect x="4" y="3.500" width="9" height="17" rx="1.500" /><path d="M16 12h5" /></>),
  play: ic(<path d="M7 4.500l12 7.500-12 7.500z" />),
};
export type JamIcon = keyof typeof JI;
export function JIcon({ n, size }: { n: JamIcon; size?: number }) { const C = JI[n]; return <C size={size} />; }

/** Tiny preview of a shape for pickers. */
export function ShapeGlyph({ kind, size = 22 }: { kind: ShapeKind; size?: number }) {
  const s = 18, o = 3; let d = '';
  if (kind === 'ellipse') d = 'M3 12a9 9 0 1018 0 9 9 0 10-18 0';
  else if (kind === 'round') return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="5" width="18" height="14" rx="5" /></svg>;
  else if (kind === 'cylinder') d = 'M4 7a8 3 0 0016 0 8 3 0 00-16 0v10a8 3 0 0016 0V7';
  else if (kind === 'speech') d = 'M4 4h16v12H11l-4 4v-4H4z';
  else (SHAPE_POLY[kind] ?? []).forEach(([x, y], i) => { d += `${i ? 'L' : 'M'}${(o + x * s).toFixed(1)} ${(o + y * s).toFixed(1)}`; }), (d += 'Z');
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d={d} /></svg>;
}
export function RouteGlyph({ route }: { route: Route }) {
  const d = route === 'straight' ? 'M4 18L20 6' : route === 'curve' ? 'M4 18C4 8 20 16 20 6' : 'M4 18h8V6h8';
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}
export function CapGlyph({ cap }: { cap: Cap }) {
  const body = cap === 'none' ? null : cap === 'arrow' ? <path d="M13 7l5 5-5 5" /> : cap === 'triangle' ? <path d="M18 12l-6-5v10z" fill="currentColor" /> : cap === 'diamond' ? <path d="M18 12l-4-3.500L10 12l4 3.500z" fill="currentColor" /> : cap === 'circle' ? <circle cx="15.500" cy="12" r="2.600" fill="currentColor" /> : <path d="M18 7v10" />;
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h13" />{body}</svg>;
}
