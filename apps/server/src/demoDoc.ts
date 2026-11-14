import { DocStore, addNode, createEmptyDocument, defaultNode, pageIds, solid, type DocumentData, type SceneNode } from '@layr/core';

/**
 * "FinPay" dashboard demo: every element is a real layer (frames, rectangles, text, vectors), so all of it is editable in the tool.
 * Coordinates below are written in the 2000px-wide reference artwork and scaled by K into the 1440px-wide frame.
 */
const K = 0.72;
const u = (v: number) => Math.round(v * K * 10) / 10;

const C = { ink: '#111827', body: '#374151', mute: '#C4C9D2', line: '#E5E7EB', blue: '#2F5BFF', blueDk: '#2563EB', blueLt: '#EEF3FF', track: '#DCE4FF', green: '#16A34A', greenLt: '#E8F8EF', red: '#DC2626', redLt: '#FDECEC', gray: '#F3F4F6', white: '#FFFFFF' };
const SHADOW = [{ type: 'DROP_SHADOW' as const, x: 0, y: 1, blur: 3, color: '#101828', opacity: 0.08, visible: true }];

export function buildDashboardDoc(): DocumentData {
  const store = new DocStore(createEmptyDocument());
  const page = pageIds(store.doc)[0];

  type Box = { id: string; ox: number; oy: number };
  const add = (n: SceneNode, parent: Box | null) => { addNode(store, n, parent ? parent.id : page); return n; };

  /** a frame whose children are positioned with absolute reference coordinates */
  const frame = (parent: Box | null, name: string, x: number, y: number, w: number, h: number, o: Partial<SceneNode> = {}): Box => {
    const n = defaultNode('FRAME', { name, x: u(x) - (parent?.ox ?? 0), y: u(y) - (parent?.oy ?? 0), width: u(w), height: u(h), fills: [], clipsContent: false, ...o });
    add(n, parent);
    return { id: n.id, ox: parent ? u(x) : u(x), oy: u(y) };
  };
  const rel = (p: Box | null, x: number, y: number) => ({ x: u(x) - (p?.ox ?? 0), y: u(y) - (p?.oy ?? 0) });

  const rect = (p: Box | null, name: string, x: number, y: number, w: number, h: number, fill: string | null, o: Partial<SceneNode> & { r?: number; stroke?: string; sw?: number } = {}) => {
    const { r, stroke, sw, ...rest } = o;
    const n = defaultNode('RECT', { name, ...rel(p, x, y), width: u(w), height: u(h), cornerRadius: r !== undefined ? u(r) : 0, fills: fill ? [solid(fill)] : [], strokes: stroke ? [solid(stroke)] : [], strokeWeight: sw ?? 1, ...rest });
    return add(n, p);
  };
  const ellipse = (p: Box | null, name: string, x: number, y: number, w: number, h: number, fill: string | null, o: Partial<SceneNode> & { stroke?: string; sw?: number } = {}) => {
    const { stroke, sw, ...rest } = o;
    const n = defaultNode('ELLIPSE', { name, ...rel(p, x, y), width: u(w), height: u(h), fills: fill ? [solid(fill)] : [], strokes: stroke ? [solid(stroke)] : [], strokeWeight: sw ?? 1, strokeAlign: 'CENTER', ...rest });
    return add(n, p);
  };
  const line = (p: Box | null, name: string, x1: number, y1: number, x2: number, color: string, weight = 1, dashes?: number[]) => {
    const n = defaultNode('LINE', { name, ...rel(p, x1, y1), width: u(x2 - x1), strokes: [solid(color)], strokeWeight: weight, dashes });
    return add(n, p);
  };
  const text = (p: Box | null, name: string, x: number, y: number, str: string, size: number, weight: number, color: string, o: { w?: number; align?: 'LEFT' | 'CENTER' | 'RIGHT' } = {}) => {
    const fs = Math.round(size * K * 2) / 2;
    const width = o.w !== undefined ? u(o.w) : Math.ceil(str.length * fs * 0.58) + 2;
    const n = defaultNode('TEXT', { name, ...rel(p, x, y), width, height: Math.round(fs * 1.3), fills: [solid(color)] });
    n.text = { ...n.text!, characters: str, fontSize: fs, fontWeight: weight, align: o.align ?? 'LEFT', resize: o.w !== undefined ? 'FIXED' : 'AUTO_WIDTH' };
    return add(n, p);
  };
  /** open or closed polyline from absolute reference points (straight segments) */
  const poly = (p: Box | null, name: string, pts: [number, number][], color: string, weight = 1.6, closed = false) => {
    const xs = pts.map(q => u(q[0])), ys = pts.map(q => u(q[1]));
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const n = defaultNode('VECTOR', {
      name, x: x0 - (p?.ox ?? 0), y: y0 - (p?.oy ?? 0), width: Math.max(1, Math.max(...xs) - x0), height: Math.max(1, Math.max(...ys) - y0), fills: [], strokes: [solid(color)], strokeWeight: weight, strokeAlign: 'CENTER', strokeCap: 'ROUND', strokeJoin: 'ROUND',
      path: { closed, points: pts.map((q, i) => ({ x: xs[i] - x0, y: ys[i] - y0, ix: 0, iy: 0, ox: 0, oy: 0 })) },
    });
    return add(n, p);
  };

  // ---- the artboard ----
  const W = 2000, H = 1640;
  const root = frame(null, 'FinPay Dashboard', 0, 0, W, H, { fills: [solid(C.white)], clipsContent: true });
  const R: Box = { id: root.id, ox: 0, oy: 0 };

  // ---- icons (each is a small group of strokes, named so it is easy to find) ----
  const icon = (p: Box, name: string, cx: number, cy: number, color: string, size = 26) => {
    const g = frame(p, name, cx - size / 2, cy - size / 2, size, size);
    const x = cx - size / 2, y = cy - size / 2, s = size / 24;
    const pt = (a: number, b: number): [number, number] => [x + a * s, y + b * s];
    const w = 1.5;
    switch (name) {
      case 'Icon / Dashboard': for (const [a, b, c, d] of [[3, 3, 8, 10], [13, 3, 8, 6], [3, 15, 8, 6], [13, 12, 8, 9]]) rect(g, 'Tile', x + a * s, y + b * s, c * s, d * s, null, { r: 2, stroke: color, sw: w }); break;
      case 'Icon / Swap': poly(g, 'Arrow right', [pt(4, 8), pt(20, 8), pt(16, 4)], color, w); poly(g, 'Arrow left', [pt(20, 16), pt(4, 16), pt(8, 20)], color, w); break;
      case 'Icon / Analytics': poly(g, 'Axis', [pt(3, 3), pt(3, 21), pt(21, 21)], color, w); for (const [a, b] of [[8, 11], [12, 7], [16, 13]]) poly(g, 'Bar', [pt(a, 21), pt(a, b)], color, w); break;
      case 'Icon / Wallet': rect(g, 'Body', x + 3 * s, y + 6 * s, 18 * s, 14 * s, null, { r: 3, stroke: color, sw: w }); poly(g, 'Flap', [pt(5, 6), pt(15, 3), pt(17, 6)], color, w); ellipse(g, 'Clasp', x + 15 * s, y + 11.5 * s, 3 * s, 3 * s, null, { stroke: color, sw: w }); break;
      case 'Icon / Card': rect(g, 'Card', x + 2 * s, y + 5 * s, 20 * s, 14 * s, null, { r: 3, stroke: color, sw: w }); line(g, 'Stripe', x + 2 * s, y + 10 * s, x + 22 * s, color, w); break;
      case 'Icon / Users': ellipse(g, 'Head', x + 6 * s, y + 3 * s, 7 * s, 7 * s, null, { stroke: color, sw: w }); poly(g, 'Body', [pt(3, 20), pt(4, 15), pt(9.5, 13), pt(15, 15), pt(16, 20)], color, w); ellipse(g, 'Head 2', x + 14 * s, y + 4 * s, 5 * s, 5 * s, null, { stroke: color, sw: w }); break;
      case 'Icon / Settings': ellipse(g, 'Ring', x + 4 * s, y + 4 * s, 16 * s, 16 * s, null, { stroke: color, sw: w }); ellipse(g, 'Hub', x + 9 * s, y + 9 * s, 6 * s, 6 * s, null, { stroke: color, sw: w }); for (const [a, b, c, d] of [[12, 1, 12, 4], [12, 20, 12, 23], [1, 12, 4, 12], [20, 12, 23, 12]]) poly(g, 'Tooth', [pt(a, b), pt(c, d)], color, w); break;
      case 'Icon / Help': ellipse(g, 'Circle', x + 2 * s, y + 2 * s, 20 * s, 20 * s, null, { stroke: color, sw: w }); text(g, 'Mark', x + 7 * s, y + 4.5 * s, '?', 15, 600, color, { w: 10 * s, align: 'CENTER' }); break;
      case 'Icon / Bell': poly(g, 'Dome', [pt(5, 17), pt(6.5, 14), pt(7, 9), pt(12, 4), pt(17, 9), pt(17.5, 14), pt(19, 17), pt(5, 17)], color, w); poly(g, 'Clapper', [pt(10, 20), pt(14, 20)], color, w); break;
      case 'Icon / Search': ellipse(g, 'Lens', x + 3 * s, y + 3 * s, 14 * s, 14 * s, null, { stroke: color, sw: w }); poly(g, 'Handle', [pt(15, 15), pt(21, 21)], color, w); break;
      case 'Icon / Chevron down': poly(g, 'Chevron', [pt(6, 9), pt(12, 15), pt(18, 9)], color, w); break;
      case 'Icon / Chevron left': poly(g, 'Chevron', [pt(15, 5), pt(8, 12), pt(15, 19)], color, w); break;
      case 'Icon / Eye': ellipse(g, 'Outline', x + 2 * s, y + 6 * s, 20 * s, 12 * s, null, { stroke: color, sw: w }); ellipse(g, 'Pupil', x + 9 * s, y + 9 * s, 6 * s, 6 * s, null, { stroke: color, sw: w }); break;
      case 'Icon / Trend up': poly(g, 'Trend', [pt(2, 17), pt(9, 10), pt(13, 14), pt(22, 5)], color, 2.2); break;
      case 'Icon / Trend down': poly(g, 'Trend', [pt(2, 6), pt(9, 13), pt(13, 9), pt(22, 18)], color, 2.2); break;
      case 'Icon / Arrow in': poly(g, 'Arrow', [pt(17, 7), pt(7, 17), pt(7, 9), pt(7, 17), pt(15, 17)], color, 2.2); break;
      case 'Icon / Arrow out': poly(g, 'Arrow', [pt(7, 17), pt(17, 7), pt(9, 7), pt(17, 7), pt(17, 15)], color, 2.2); break;
    }
    return g;
  };

  // ---- sidebar ----
  const side = frame(R, 'Sidebar', 0, 0, 345, H, { fills: [solid(C.white)] });
  rect(side, 'Border', 344, 0, 1.4, H, C.line);
  rect(side, 'Logo', 23, 29, 52, 52, C.blueDk, { r: 8 });
  text(side, 'Logo mark', 23, 43, 'FP', 20, 700, C.white, { w: 52, align: 'CENTER' });
  text(side, 'Brand', 92, 41, 'FinPay', 25, 700, C.ink);
  rect(side, 'Brand divider', 0, 110, 345, 1.4, C.line);
  const nav = frame(side, 'Navigation', 17, 134, 310, 350);
  const items: [string, string][] = [['Dashboard', 'Icon / Dashboard'], ['Transactions', 'Icon / Swap'], ['Analytics', 'Icon / Analytics'], ['Wallets', 'Icon / Wallet'], ['Cards', 'Icon / Card'], ['Contacts', 'Icon / Users']];
  items.forEach(([label, ic], i) => {
    const y = 134 + i * 59, active = i === 0;
    const row = frame(nav, `Nav / ${label}`, 17, y, 310, 54);
    if (active) rect(row, 'Active background', 17, y, 310, 54, C.blueDk, { r: 8 });
    icon(row, ic, 49, y + 27, active ? C.white : C.body);
    text(row, 'Label', 81, y + 14, label, 21, active ? 600 : 400, active ? C.white : C.body);
  });
  rect(side, 'Footer divider', 17, 1209, 310, 1.4, C.line);
  const foot = frame(side, 'Footer', 17, 1230, 310, 190);
  icon(foot, 'Icon / Settings', 49, 1260, C.body); text(foot, 'Settings', 81, 1246, 'Settings', 21, 400, C.body);
  icon(foot, 'Icon / Help', 49, 1319, C.body); text(foot, 'Help Center', 81, 1305, 'Help Center', 21, 400, C.body);
  icon(foot, 'Icon / Chevron left', 302, 1389, C.body, 22);

  // ---- header ----
  const head = frame(R, 'Header', 346, 0, 1654, 123);
  rect(head, 'Border', 346, 122, 1654, 1.4, C.line);
  text(head, 'Title', 393, 20, 'Dashboard', 37, 700, C.ink);
  text(head, 'Subtitle', 393, 71, 'Welcome back, Alex', 17, 400, C.mute);
  rect(head, 'Date range', 1124, 38, 202, 46, C.gray, { r: 6, stroke: C.line });
  text(head, 'Date range label', 1144, 50, 'Last 30 days', 20, 400, C.body); icon(head, 'Icon / Chevron down', 1296, 61, C.mute, 22);
  rect(head, 'Search field', 1343, 35, 288, 52, C.gray, { r: 6, stroke: C.line });
  icon(head, 'Icon / Search', 1372, 61, C.mute, 22); text(head, 'Search placeholder', 1395, 50, 'Search...', 20, 400, C.mute);
  icon(head, 'Icon / Bell', 1675, 61, C.body, 28);
  rect(head, 'Badge', 1678, 29, 28, 28, C.red, { r: 6 }); text(head, 'Badge count', 1678, 33, '3', 16, 700, C.white, { w: 28, align: 'CENTER' });
  ellipse(head, 'Avatar', 1730, 38, 46, 46, C.blueDk); text(head, 'Avatar initials', 1730, 51, 'AM', 17, 700, C.white, { w: 46, align: 'CENTER' });
  text(head, 'User name', 1789, 37, 'Alex Morgan', 20, 600, C.ink); text(head, 'User role', 1789, 65, 'Admin', 16, 400, C.mute);
  icon(head, 'Icon / Chevron down', 1933, 61, C.mute, 22);

  // ---- stat cards ----
  const stats = [
    { x: 393, label: 'Total Revenue', value: '$284,520', delta: '+12.5%', up: true, tint: C.blueLt, glyph: '$', gc: C.blueDk },
    { x: 790, label: 'Active Users', value: '14,832', delta: '+8.2%', up: true, tint: C.greenLt, icon: 'Icon / Users', gc: C.green },
    { x: 1187, label: 'Transactions', value: '8,456', delta: '-2.4%', up: false, tint: C.blueLt, icon: 'Icon / Swap', gc: C.blueDk },
    { x: 1585, label: 'Conversion Rate', value: '3.24%', delta: '+1.8%', up: true, tint: C.gray, glyph: '%', gc: C.body },
  ];
  const statRow = frame(R, 'Stat cards', 393, 170, 1560, 208);
  for (const s of stats) {
    const c = frame(statRow, `Stat / ${s.label}`, s.x, 170, 368, 208);
    rect(c, 'Card', s.x, 170, 368, 208, C.white, { r: 6, stroke: C.line, effects: SHADOW });
    text(c, 'Label', s.x + 30, 203, s.label, 17, 400, C.mute);
    text(c, 'Value', s.x + 30, 236, s.value, 49, 700, C.ink);
    rect(c, 'Icon tile', s.x + 274, 200, 64, 64, s.tint, { r: 6 });
    if (s.glyph) text(c, 'Icon glyph', s.x + 274, 213, s.glyph, 34, 500, s.gc, { w: 64, align: 'CENTER' }); else icon(c, s.icon!, s.x + 306, 232, s.gc, 32);
    rect(c, 'Delta badge', s.x + 30, 314, 100, 30, s.up ? C.greenLt : C.redLt, { r: 4 });
    icon(c, s.up ? 'Icon / Trend up' : 'Icon / Trend down', s.x + 47, 329, s.up ? C.green : C.red, 18);
    text(c, 'Delta', s.x + 58, 318, s.delta, 17, 600, s.up ? C.green : C.red);
    text(c, 'Comparison', s.x + 140, 318, 'vs last month', 17, 400, C.mute);
  }

  // ---- financial overview ----
  const chart = frame(R, 'Financial overview', 393, 414, 1028, 590);
  rect(chart, 'Card', 393, 414, 1028, 590, C.white, { r: 6, stroke: C.line, effects: SHADOW });
  text(chart, 'Title', 428, 460, 'Financial Overview', 24, 600, C.ink);
  rect(chart, 'Toggle track', 1170, 451, 216, 50, C.gray, { r: 12 });
  text(chart, 'Toggle: Revenue', 1182, 464, 'Revenue', 20, 500, C.ink); text(chart, 'Toggle: Volume', 1296, 464, 'Volume', 20, 500, C.ink);
  ellipse(chart, 'Legend dot revenue', 428, 523, 14, 14, C.blue); text(chart, 'Legend revenue', 451, 520, 'Revenue', 17, 400, C.mute);
  ellipse(chart, 'Legend dot expenses', 545, 523, 14, 14, C.red); text(chart, 'Legend expenses', 568, 520, 'Expenses', 17, 400, C.mute);
  const grid = frame(chart, 'Grid', 428, 570, 950, 370);
  [['2800', 580], ['2100', 666], ['1400', 752], ['700', 839], ['0', 925]].forEach(([lab, y]) => {
    text(grid, `Axis ${lab}`, 440, Number(y) - 11, String(lab), 17, 400, C.mute, { w: 63, align: 'RIGHT' });
    line(grid, `Gridline ${lab}`, 515, Number(y), 1372, Number(lab) === 0 ? C.line : C.line, 1, Number(lab) === 0 ? undefined : [5, 4]);
  });
  const bars = frame(chart, 'Bars', 520, 590, 850, 370);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const xs = [527, 598, 670, 741, 813, 884, 955, 1027, 1098, 1170, 1241, 1312], tops = [773, 738, 755, 722, 692, 713, 678, 685, 650, 666, 620, 599];
  months.forEach((m, i) => {
    rect(bars, `Bar ${m}`, xs[i], tops[i], 46, 925 - tops[i], C.blue, { r: 2 });
    text(bars, `Month ${m}`, xs[i] - 12, 937, m, 17, 400, C.mute, { w: 70, align: 'CENTER' });
  });

  // ---- recent transactions ----
  const tx = frame(R, 'Recent transactions', 393, 1040, 1028, 560);
  rect(tx, 'Card', 393, 1040, 1028, 560, C.white, { r: 6, stroke: C.line, effects: SHADOW });
  text(tx, 'Title', 428, 1072, 'Recent Transactions', 24, 600, C.ink);
  rect(tx, 'Divider', 1385, 1076, 1.4, 44, C.line); text(tx, 'View all', 1404, 1087, 'View All', 20, 500, C.ink);
  [['Transaction', 440], ['Method', 715], ['Date', 919], ['Amount', 1069], ['Status', 1209]].forEach(([h, x]) => text(tx, `Column ${h}`, Number(x), 1175, String(h), 17, 400, C.mute));
  const rows = [
    { i: 'SJ', n: 'Sarah Johnson', id: 'TXN-001', m: 'Bank Transfer', d: 'Feb 21, 2026', a: '+$2,450.00', pos: true, s: 'Completed' },
    { i: 'CS', n: 'Cloud Services Inc.', id: 'TXN-002', m: 'Card Payment', d: 'Feb 20, 2026', a: '-$890.00', pos: false, s: 'Completed' },
    { i: 'ML', n: 'Marcus Lee', id: 'TXN-003', m: 'Wire Transfer', d: 'Feb 20, 2026', a: '+$5,120.00', pos: true, s: 'Pending' },
    { i: 'EW', n: 'Emma Wilson', id: 'TXN-004', m: 'Bank Transfer', d: 'Feb 19, 2026', a: '+$1,280.00', pos: true, s: 'Completed' },
    { i: 'DP', n: 'Design Pro Studio', id: 'TXN-005', m: 'Card Payment', d: 'Feb 18, 2026', a: '-$2,300.00', pos: false, s: 'Pending' },
  ];
  rows.forEach((r, k) => {
    const y = 1213 + k * 73.5;
    const row = frame(tx, `Row / ${r.id}`, 428, y, 958, 74);
    rect(row, 'Row divider', 428, y, 958, 1.4, C.line);
    ellipse(row, 'Avatar', 440, y + 16, 46, 46, C.gray); text(row, 'Initials', 440, y + 29, r.i, 17, 700, C.ink, { w: 46, align: 'CENTER' });
    text(row, 'Name', 503, y + 15, r.n, 20, 600, C.ink); text(row, 'Reference', 503, y + 41, r.id, 17, 400, C.mute);
    ellipse(row, 'Method icon bg', 715, y + 22, 34, 34, r.pos ? C.greenLt : C.redLt);
    icon(row, r.pos ? 'Icon / Arrow in' : 'Icon / Arrow out', 732, y + 39, r.pos ? C.green : C.red, 18);
    text(row, 'Method', 762, y + 25, r.m, 20, 400, C.ink); text(row, 'Date', 919, y + 26, r.d, 20, 400, C.mute);
    text(row, 'Amount', 1069, y + 25, r.a, 20, 600, r.pos ? C.green : C.red);
    const done = r.s === 'Completed';
    rect(row, 'Status pill', 1209, y + 24, done ? 115 : 92, 28, done ? C.greenLt : C.blueLt, { r: 4 });
    text(row, 'Status', 1209, y + 28, r.s, 17, 600, done ? C.green : C.blueDk, { w: done ? 115 : 92, align: 'CENTER' });
    text(row, 'More', 1358, y + 26, '•••', 17, 700, C.body);
  });

  // ---- wallets ----
  const wal = frame(R, 'My wallets', 1457, 415, 496, 735);
  text(wal, 'Title', 1457, 421, 'My Wallets', 24, 600, C.ink); icon(wal, 'Icon / Eye', 1931, 437, C.mute, 28);
  const wallets = [
    { y: 484, h: 223, i: 'U', name: 'US Dollar', code: 'USD', d: '+5.2%', up: true, amt: '$24,580.42', note: '$12,400 / $25,000', p: 0.497 },
    { y: 726, h: 222, i: 'E', name: 'Euro', code: 'EUR', d: '-1.8%', up: false, amt: '€8,320.15', note: '$3,200 / $10,000', p: 0.32 },
    { y: 967, h: 163, i: 'B', name: 'Bitcoin', code: 'BTC', d: '+12.4%', up: true, amt: '0.4521 BTC', note: '', p: 0 },
  ];
  for (const w of wallets) {
    const c = frame(wal, `Wallet / ${w.name}`, 1457, w.y, 496, w.h);
    rect(c, 'Card', 1457, w.y, 496, w.h, C.white, { r: 6, stroke: C.line, effects: SHADOW });
    rect(c, 'Avatar', 1481, w.y + 25, 46, 46, C.blueDk, { r: 6 }); text(c, 'Initial', 1481, w.y + 38, w.i, 18, 700, C.white, { w: 46, align: 'CENTER' });
    text(c, 'Name', 1539, w.y + 24, w.name, 20, 600, C.ink); text(c, 'Code', 1539, w.y + 50, w.code, 17, 400, C.mute);
    rect(c, 'Delta badge', 1857, w.y + 25, w.d.length > 5 ? 74 : 72, 30, w.up ? C.greenLt : C.redLt, { r: 4 });
    text(c, 'Delta', 1857, w.y + 29, w.d, 17, 600, w.up ? C.green : C.red, { w: w.d.length > 5 ? 74 : 72, align: 'CENTER' });
    text(c, 'Amount', 1481, w.y + 71, w.amt, 37, 700, C.ink);
    if (w.note) {
      text(c, 'Spent label', 1481, w.y + 148, 'Spent this month', 17, 400, C.mute); text(c, 'Spent figures', 1700, w.y + 147, w.note, 17, 600, C.ink, { w: 230, align: 'RIGHT' });
      rect(c, 'Progress track', 1481, w.y + 178, 449, 8, C.track, { r: 4 }); rect(c, 'Progress fill', 1481, w.y + 178, Math.round(449 * w.p), 8, C.blueDk, { r: 4 });
    }
  }

  // ---- spending breakdown ----
  const sp = frame(R, 'Spending breakdown', 1457, 1166, 496, 374);
  rect(sp, 'Card', 1457, 1166, 496, 374, C.white, { r: 6, stroke: C.line, effects: SHADOW });
  text(sp, 'Title', 1493, 1195, 'Spending Breakdown', 24, 600, C.ink);
  const cx = 1554, cy = 1356, d = 108, sw = 24, circ = Math.PI * d;
  const slices = [{ n: 'Operations', v: 34, c: C.green }, { n: 'Subscriptions', v: 19, c: C.blueDk }, { n: 'Marketing', v: 12, c: C.red }, { n: 'Infrastructure', v: 25, c: C.blueDk }];
  let angle = 180;
  const donut = frame(sp, 'Donut', cx - 66, cy - 66, 132, 132);
  for (const s of slices) {
    const len = (s.v / 100) * circ, th = (angle * Math.PI) / 180;
    const w = u(d), hw = w / 2, ox = u(cx) - donut.ox - (hw * Math.cos(th) - hw * Math.sin(th)), oy = u(cy) - donut.oy - (hw * Math.sin(th) + hw * Math.cos(th));
    const n = defaultNode('ELLIPSE', { name: `Slice / ${s.n}`, x: ox, y: oy, width: w, height: w, rotation: angle % 360, fills: [], strokes: [solid(s.c)], strokeWeight: u(sw), strokeAlign: 'CENTER', dashes: [Math.max(1, u(len) - 1.5), 9999], strokeCap: 'NONE' });
    add(n, donut);
    angle += (s.v / 100) * 360;
  }
  text(sp, 'Total value', cx - 60, cy + 6, '$17.0k', 24, 700, C.ink, { w: 120, align: 'CENTER' }); text(sp, 'Total label', cx - 60, cy + 38, 'Total', 16, 400, C.mute, { w: 120, align: 'CENTER' });
  const legend = frame(sp, 'Legend', 1646, 1285, 300, 160);
  const lg = [['Subscriptions', '$3,200', '19%', C.blueDk], ['Operations', '$5,800', '34%', C.green], ['Marketing', '$2,100', '12%', C.red], ['Infrastructure', '$4,300', '25%', C.blueDk]];
  lg.forEach(([n, a, pc, col], i) => {
    const y = 1301 + i * 40.3;
    ellipse(legend, `Dot ${n}`, 1649, y - 7, 14, 14, col); text(legend, `Label ${n}`, 1675, y - 11, n, 19, 400, C.ink);
    text(legend, `Amount ${n}`, 1788, y - 11, a, 19, 600, C.ink); text(legend, `Share ${n}`, 1887, y - 11, pc, 17, 400, C.mute);
  });

  return store.doc;
}
