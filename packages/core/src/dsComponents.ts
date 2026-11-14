/**
 * The default design system: the UI components that appear across web, iOS, Android and desktop products,
 * each with variants, built from shared colour / radius tokens so they look like one family.
 * `buildDefaultDesignSystem` returns an ordinary document: open it in the editor to change any component.
 */
import { defaultNode, type DocumentData, type PropDef, type SceneNode } from './model';
import { variantName } from './components';
import type { TextFit } from './layout';
import { Div, E, F, Ic, Kit, R, SearchIcon, T, V, col, row, useKit, type Kid, type N } from './dsKit';

interface Pg { id: string; name: string; x: number; y: number; rowH: number }
/** node id → name of the build page it was first placed on */
const origin = new Map<string, string>();
type Vr = Record<string, string>;

let K: Kit;

function cartesian(lists: string[][]): string[][] { return lists.reduce<string[][]>((acc, l) => acc.flatMap(a => l.map(x => [...a, x])), [[]]); }
function walk(x: N, f: (n: SceneNode) => void) { f(x.n); x.k.forEach(c => walk(c, f)); }

function place(pg: Pg, id: string) {
  const n = K.doc.nodes[id];
  if (pg.x > 0 && pg.x + n.width > 2200) { pg.x = 0; pg.y += pg.rowH + 96; pg.rowH = 0; }
  origin.set(id, pg.name);
  n.x = pg.x; n.y = pg.y; pg.x += n.width + 96; pg.rowH = Math.max(pg.rowH, n.height);
}

/** Component properties implied by the layers bound in the build (label text, optional icons …). */
function collectProps(roots: N[]): PropDef[] {
  const defs = new Map<string, PropDef>();
  for (const r of roots) walk(r, n => {
    if (n.bind?.characters && !defs.has(n.bind.characters)) defs.set(n.bind.characters, { name: n.bind.characters, type: 'TEXT', default: n.text?.characters ?? '' });
    if (n.bind?.visible && !defs.has(n.bind.visible)) defs.set(n.bind.visible, { name: n.bind.visible, type: 'BOOLEAN', default: n.visible });
  });
  return [...defs.values()];
}

const PREFERRED = ['Default', 'M', 'Regular', 'Medium', 'Primary', 'Outlined', 'Elevated', 'Solid', 'Neutral', 'Unchecked', 'Off', 'No', 'Hidden', 'Collapsed', 'Expanded', 'Standard', 'Confirm', 'Received', 'Desktop', 'Light', 'Inline', 'Numbered', 'Underline', 'Vertical', 'Horizontal', 'Initials', 'Circle', 'Small', 'Empty', 'Hint', 'Info', 'Filled', 'Left', 'Top', 'One line', 'Icon top', 'Basic', 'Soft', 'Up', 'Done', 'Gesture', 'Phone', 'Dot', 'Text', 'Body'];
/** The variant an instance starts as: the "ordinary" value of every property (Default, M, Primary …; the middle of numeric ranges). */
function pickDefault(props: Record<string, string[]>): Vr {
  return Object.fromEntries(Object.entries(props).map(([k, vals]) => [k, vals.find(v => PREFERRED.includes(v)) ?? (vals.every(v => /^\d+$/.test(v)) ? vals[Math.floor((vals.length - 1) / 2)] : vals[0])]));
}

/** A component set: one COMPONENT per combination of the variant properties, laid out as a grid (first property = columns). */
function set(pg: Pg, name: string, props: Record<string, string[]>, build: (v: Vr) => N) {
  const names = Object.keys(props);
  const combos: Vr[] = [];
  for (const r of cartesian(names.slice(1).map(k => props[k]))) for (const first of props[names[0]]) combos.push(Object.fromEntries([[names[0], first], ...names.slice(1).map((k, i) => [k, r[i]])]));
  const roots = combos.map(v => { const root = build(v); root.n.type = 'COMPONENT'; root.n.variant = v; root.n.name = variantName(v); return root; });
  const setNode = defaultNode('COMPONENT_SET', { name, fills: [], clipsContent: false, strokes: [{ type: 'SOLID', color: '#9747FF', opacity: 1, visible: true }], strokeWeight: 1, strokeAlign: 'INSIDE', props: collectProps(roots), cornerRadius: 5 });
  K.attach({ n: setNode, k: roots }, pg.id);
  roots.forEach(r => K.layout(r.n.id));
  const ncols = names.length > 1 ? props[names[0]].length : props[names[0]].length <= 4 ? props[names[0]].length : 1;
  const nrows = Math.ceil(combos.length / ncols), GAP = 28, PAD = 28;
  const cw = Array.from({ length: ncols }, (_, c) => Math.max(...roots.filter((_, i) => i % ncols === c).map(r => r.n.width)));
  const rh = Array.from({ length: nrows }, (_, rr) => Math.max(...roots.filter((_, i) => Math.floor(i / ncols) === rr).map(r => r.n.height)));
  roots.forEach((r, i) => { r.n.x = PAD + cw.slice(0, i % ncols).reduce((a, b) => a + b + GAP, 0); r.n.y = PAD + rh.slice(0, Math.floor(i / ncols)).reduce((a, b) => a + b + GAP, 0); });
  const def = pickDefault(props), di = combos.findIndex(c => Object.entries(def).every(([k, v]) => c[k] === v));
  if (di > 0) setNode.children = [roots[di].n.id, ...setNode.children.filter(c => c !== roots[di].n.id)]; // the default variant comes first
  setNode.width = PAD * 2 + cw.reduce((a, b) => a + b, 0) + GAP * (ncols - 1);
  setNode.height = PAD * 2 + rh.reduce((a, b) => a + b, 0) + GAP * (nrows - 1);
  place(pg, setNode.id);
}
/** A single component (no variants) */
function comp(pg: Pg, name: string, build: () => N) {
  const root = build(); root.n.type = 'COMPONENT'; root.n.name = name;
  const defs = collectProps([root]); if (defs.length) root.n.props = defs;
  K.attach(root, pg.id); K.layout(root.n.id); place(pg, root.n.id);
}

// ---------- shared pieces ----------
const SZ: Record<string, { h: number; px: number; fs: number }> = { S: { h: 32, px: 12, fs: 13 }, M: { h: 40, px: 16, fs: 14 }, L: { h: 48, px: 20, fs: 16 } };
const lorem = 'Design systems keep every screen consistent, so teams can ship faster.';
const circle = (d: number, fill: string, o: object = {}) => E({ w: d, h: d, fill, ...o });
const imagePh = (w: number | 'fill', h: number, r: number | number[] = 0) => R({ name: 'Image', w, h, fill: '$surfaceAlt', r: r as number });
const avatar = (d: number, label?: string, fill = '$secondary', fg = '$onSecondary') => label
  ? F({ name: 'Avatar', w: d, h: d, main: 'center', cross: 'center', fill, r: d / 2 }, T(label, { s: Math.round(d * 0.4), w: 600, c: fg }))
  : circle(d, fill, { name: 'Avatar' });
const checkBox = (on: boolean, mixed: boolean, dis: boolean) => F({ name: 'Box', w: 20, h: 20, main: 'center', cross: 'center', r: 5, fill: dis ? '$disabledBg' : on || mixed ? '$primary' : '$surface', stroke: dis ? '$border' : on || mixed ? '$primary' : '$borderStrong', sw: 1.5 },
  on ? Ic('check', 13, dis ? '$textDisabled' : '$onPrimary') : mixed ? R({ w: 10, h: 2, fill: dis ? '$textDisabled' : '$onPrimary', r: 1 }) : false);
const arc = (d: number, frac: number, sw: number, c: string): N => {
  const pts: [number, number][] = [], r = (d - sw) / 2, steps = Math.max(2, Math.round(40 * frac));
  for (let i = 0; i <= steps; i++) { const a = -Math.PI / 2 + (frac * 2 * Math.PI * i) / steps; pts.push([d / 2 + r * Math.cos(a), d / 2 + r * Math.sin(a)]); }
  return V(d, d, pts, { c, sw, name: 'Arc' });
};
const ringLayer = (d: number, frac: number, sw: number, c: string, track = '$border'): N => { const f = F({ name: 'Ring', w: d, h: d }); f.n.layout = undefined; const t = E({ w: d, h: d, stroke: track, sw }); const a = arc(d, frac, sw, c); f.k = [t, a]; return f; };

export function buildDefaultDesignSystem(fit?: TextFit): DocumentData {
  K = new Kit(fit); useKit(K);
  origin.clear();
  const page = (name: string): Pg => ({ id: K.addPage(name), name, x: 0, y: 0, rowH: 0 });

  // ================= Actions =================
  let pg = page('Actions');
  set(pg, 'Button', { Type: ['Primary', 'Secondary', 'Outline', 'Ghost', 'Danger'], Size: ['S', 'M', 'L'], State: ['Default', 'Disabled'] }, v => {
    const z = SZ[v.Size], dis = v.State === 'Disabled', t = v.Type;
    const fill = dis ? (t === 'Outline' || t === 'Ghost' ? undefined : '$disabledBg') : t === 'Primary' ? '$primary' : t === 'Secondary' ? '$secondary' : t === 'Danger' ? '$danger' : undefined;
    const fg = dis ? '$textDisabled' : t === 'Primary' ? '$onPrimary' : t === 'Secondary' ? '$onSecondary' : t === 'Danger' ? '#FFFFFF' : t === 'Outline' ? '$text' : '$primary';
    return row({ name: 'Button', h: z.h, pad: [0, z.px], gap: 8, main: 'center', fill, stroke: t === 'Outline' ? (dis ? '$border' : '$borderStrong') : undefined, r: 'md' },
      Ic('plus', z.fs, fg, { vis: 'Leading icon', hidden: true }), T('Button', { s: z.fs, w: 600, c: fg, prop: 'Label' }), Ic('right', z.fs + 2, fg, { vis: 'Trailing icon', hidden: true }));
  });
  set(pg, 'Icon Button', { Style: ['Filled', 'Tonal', 'Outline', 'Ghost'], Size: ['S', 'M', 'L'] }, v => {
    const d = { S: 32, M: 40, L: 48 }[v.Size]!;
    const fg = v.Style === 'Filled' ? '$onPrimary' : v.Style === 'Tonal' ? '$onSecondary' : '$text';
    return F({ name: 'Icon Button', w: d, h: d, main: 'center', cross: 'center', r: 'md', fill: v.Style === 'Filled' ? '$primary' : v.Style === 'Tonal' ? '$secondary' : undefined, stroke: v.Style === 'Outline' ? '$borderStrong' : undefined }, Ic('plus', d * 0.45, fg));
  });
  set(pg, 'Floating Action Button', { Type: ['Circle', 'Extended'], Size: ['Small', 'Regular', 'Large'] }, v => {
    const d = { Small: 40, Regular: 56, Large: 72 }[v.Size]!;
    return v.Type === 'Circle'
      ? F({ name: 'FAB', w: d, h: d, main: 'center', cross: 'center', r: d / 2, fill: '$primary', shadow: 'md' }, Ic('plus', d * 0.45, '$onPrimary'))
      : row({ name: 'FAB', h: d, pad: [0, d * 0.4], gap: 8, main: 'center', r: d / 2, fill: '$primary', shadow: 'md' }, Ic('plus', d * 0.36, '$onPrimary'), T('Create', { s: d * 0.28, w: 600, c: '$onPrimary', prop: 'Label' }));
  });
  set(pg, 'Link', { State: ['Default', 'Hover', 'Visited', 'Disabled'] }, v => row({ name: 'Link' }, T('Learn more', { s: 14, w: 500, c: v.State === 'Visited' ? '#7C3AED' : v.State === 'Disabled' ? '$textDisabled' : '$primary', deco: v.State === 'Hover' || v.State === 'Default' ? 'UNDERLINE' : undefined, prop: 'Label' })));
  set(pg, 'Chip', { Style: ['Filled', 'Outline', 'Input'], State: ['Default', 'Selected', 'Disabled'] }, v => {
    const sel = v.State === 'Selected', dis = v.State === 'Disabled';
    const fg = dis ? '$textDisabled' : sel ? '$onSecondary' : '$text';
    return row({ name: 'Chip', h: 32, pad: [0, 12], gap: 6, r: 16, fill: dis ? '$disabledBg' : sel ? '$secondary' : v.Style === 'Filled' ? '$surfaceAlt' : undefined, stroke: v.Style === 'Filled' ? undefined : dis ? '$border' : sel ? '$primary' : '$borderStrong' },
      sel && v.Style !== 'Input' ? Ic('check', 13, fg) : false, T('Chip', { s: 13, w: 500, c: fg, prop: 'Label' }), v.Style === 'Input' ? Ic('close', 12, fg) : false);
  });
  set(pg, 'Segmented Control', { Segments: ['2', '3', '4'], Selected: ['First', 'Last'] }, v => {
    const n = Number(v.Segments), items = ['Day', 'Week', 'Month', 'Year'].slice(0, n);
    return row({ name: 'Segmented Control', pad: 3, gap: 2, r: 'md', fill: '$surfaceAlt' }, ...items.map((t, i) => {
      const on = v.Selected === 'First' ? i === 0 : i === n - 1;
      return F({ name: 'Segment', h: 32, pad: [0, 16], main: 'center', cross: 'center', r: 6, fill: on ? '$surface' : undefined, shadow: on ? 'sm' : undefined }, T(t, { s: 13, w: on ? 600 : 500, c: on ? '$text' : '$textMuted' }));
    }));
  });
  set(pg, 'Social Button', { Provider: ['Google', 'Apple', 'GitHub', 'Facebook'] }, v => {
    const c = { Google: '#EA4335', Apple: '#000000', GitHub: '#24292F', Facebook: '#1877F2' }[v.Provider]!;
    return row({ name: 'Social Button', w: 280, h: 44, gap: 10, main: 'center', r: 'md', stroke: '$borderStrong', fill: '$surface' }, circle(18, c, { name: 'Logo' }), T(`Continue with ${v.Provider}`, { s: 14, w: 600 }));
  });
  set(pg, 'Split Button', { State: ['Default', 'Disabled'] }, v => {
    const dis = v.State === 'Disabled', fg = dis ? '$textDisabled' : '$onPrimary', fill = dis ? '$disabledBg' : '$primary';
    return row({ name: 'Split Button', h: 40, r: 'md', fill, clip: true }, F({ h: 40, pad: [0, 16], main: 'center', cross: 'center' }, T('Save', { s: 14, w: 600, c: fg })), R({ w: 1, h: 24, fill: fg, op: 0.4 }), F({ h: 40, w: 36, main: 'center', cross: 'center' }, Ic('down', 12, fg)));
  });

  // ================= Inputs & Forms =================
  pg = page('Inputs & Forms');
  const inputBox = (v: Vr, content: N[], h = 44) => {
    const st = v.State, err = st === 'Error', dis = st === 'Disabled', foc = st === 'Focused', out = (v.Type ?? 'Outlined') === 'Outlined';
    return row({ name: 'Input', w: 'fill', h, pad: [0, 12], gap: 8, r: 'md', fill: dis ? '$disabledBg' : out ? '$surface' : '$surfaceAlt', stroke: err ? '$danger' : foc ? '$primary' : out ? (dis ? '$border' : '$borderStrong') : undefined, sw: foc || err ? 2 : 1 }, ...content);
  };
  const fieldWrap = (v: Vr, box: N, w = 300) => col({ name: 'Field', w, gap: 6 },
    T('Label', { s: 13, w: 600, c: v.State === 'Disabled' ? '$textDisabled' : '$text', prop: 'Label' }), box,
    T(v.State === 'Error' ? 'This field is required' : 'Helper text', { s: 12, c: v.State === 'Error' ? '$danger' : '$textMuted', prop: 'Helper' }));
  const txt = (v: Vr, ph = 'Placeholder') => T(v.State === 'Default' || v.State === 'Focused' || v.State === 'Disabled' ? ph : 'Entered value', { s: 14, c: v.State === 'Disabled' ? '$textDisabled' : v.State === 'Default' || v.State === 'Focused' ? '$textMuted' : '$text', prop: 'Text' });
  set(pg, 'Text Field', { Type: ['Outlined', 'Filled'], State: ['Default', 'Focused', 'Filled', 'Error', 'Disabled'] }, v => fieldWrap(v, inputBox(v, [txt(v)])));
  set(pg, 'Text Area', { State: ['Default', 'Focused', 'Error', 'Disabled'] }, v => fieldWrap(v, inputBox(v, [txt(v, 'Write a message…')], 96)));
  set(pg, 'Search Field', { State: ['Default', 'Focused', 'Filled'] }, v => row({ name: 'Search Field', w: 300, h: 40, pad: [0, 12], gap: 8, r: 20, fill: '$surfaceAlt', stroke: v.State === 'Focused' ? '$primary' : undefined, sw: 2 },
    SearchIcon(16), T(v.State === 'Filled' ? 'design system' : 'Search', { s: 14, c: v.State === 'Filled' ? '$text' : '$textMuted', prop: 'Text', w: 400 }), v.State === 'Filled' ? Ic('close', 12, '$textMuted') : false));
  set(pg, 'Password Field', { State: ['Hidden', 'Visible', 'Error'] }, v => { const w = { ...v, State: v.State === 'Error' ? 'Error' : 'Filled' };
    return fieldWrap(w, inputBox(w, [T(v.State === 'Visible' ? 'hunter2!' : '••••••••', { s: 14, prop: 'Text' }), F({ w: 'fill' }), Ic('eye', 16, '$textMuted')]), 300); });
  set(pg, 'Select', { State: ['Default', 'Open', 'Filled', 'Error', 'Disabled'] }, v => { const w = { ...v, State: v.State === 'Open' ? 'Focused' : v.State };
    return fieldWrap(w, inputBox(w, [T(v.State === 'Filled' ? 'Option two' : 'Select an option', { s: 14, c: v.State === 'Filled' ? '$text' : v.State === 'Disabled' ? '$textDisabled' : '$textMuted', prop: 'Text' }), F({ w: 'fill' }), Ic(v.State === 'Open' ? 'up' : 'down', 13, '$textMuted')])); });
  set(pg, 'Number Stepper', { State: ['Default', 'Disabled'] }, v => { const d = v.State === 'Disabled', c = d ? '$textDisabled' : '$text';
    return row({ name: 'Number Stepper', h: 40, r: 'md', stroke: d ? '$border' : '$borderStrong', fill: d ? '$disabledBg' : '$surface', clip: true }, F({ w: 40, h: 40, main: 'center', cross: 'center' }, Ic('minus', 16, c)), Div({ v: true }), F({ w: 56, h: 40, main: 'center', cross: 'center' }, T('1', { s: 14, w: 600, c })), Div({ v: true }), F({ w: 40, h: 40, main: 'center', cross: 'center' }, Ic('plus', 16, c))); });
  set(pg, 'Slider', { Value: ['0', '25', '50', '75', '100'] }, v => {
    const f = Number(v.Value) / 100, w = 240;
    const f1 = F({ name: 'Slider', w, h: 24 }); f1.n.layout = undefined;
    const track = R({ w, h: 4, fill: '$border', r: 2 }); track.n.y = 10;
    const fillBar = R({ w: Math.max(0.01, w * f), h: 4, fill: '$primary', r: 2 }); fillBar.n.y = 10;
    const thumb = circle(20, '$surface', { stroke: '$primary', sw: 2, shadow: 'sm', name: 'Thumb' }); thumb.n.x = Math.min(w - 20, Math.max(0, w * f - 10)); thumb.n.y = 2;
    f1.k = [track, fillBar, thumb]; return f1;
  });
  set(pg, 'Range Slider', { Range: ['Narrow', 'Wide'] }, v => {
    const w = 240, a = v.Range === 'Narrow' ? 0.4 : 0.15, b = v.Range === 'Narrow' ? 0.6 : 0.85;
    const f1 = F({ name: 'Range Slider', w, h: 24 }); f1.n.layout = undefined;
    const track = R({ w, h: 4, fill: '$border', r: 2 }); track.n.y = 10;
    const bar = R({ w: w * (b - a), h: 4, fill: '$primary', r: 2 }); bar.n.x = w * a; bar.n.y = 10;
    const t1 = circle(20, '$surface', { stroke: '$primary', sw: 2, shadow: 'sm', name: 'Thumb start' }); t1.n.x = w * a - 10; t1.n.y = 2;
    const t2 = circle(20, '$surface', { stroke: '$primary', sw: 2, shadow: 'sm', name: 'Thumb end' }); t2.n.x = w * b - 10; t2.n.y = 2;
    f1.k = [track, bar, t1, t2]; return f1;
  });
  set(pg, 'Date Field', { State: ['Default', 'Filled', 'Error'] }, v => { const w = { ...v, State: v.State === 'Default' ? 'Default' : v.State };
    return fieldWrap(w, inputBox(w, [Ic('cal', 16, '$textMuted'), T(v.State === 'Default' ? 'MM / DD / YYYY' : '12 / 24 / 2026', { s: 14, c: v.State === 'Default' ? '$textMuted' : '$text', prop: 'Text' })])); });
  comp(pg, 'Calendar', () => {
    const rows: N[] = []; let d = 0;
    for (let r = 0; r < 5; r++) rows.push(row({ name: 'Week', gap: 0 }, ...Array.from({ length: 7 }, () => { d++; const sel = d === 14, today = d === 9;
      return F({ name: 'Day', w: 36, h: 36, main: 'center', cross: 'center', r: 18, fill: sel ? '$primary' : undefined, stroke: today && !sel ? '$primary' : undefined }, T(String(d), { s: 13, w: sel ? 600 : 400, c: sel ? '$onPrimary' : '$text' })); })));
    return col({ name: 'Calendar', w: 284, pad: 16, gap: 8, r: 'lg', fill: '$surface', stroke: '$border', shadow: 'md' },
      row({ w: 'fill', main: 'between' }, Ic('left', 20), T('November 2026', { s: 14, w: 600 }), Ic('right', 20)),
      row({ name: 'Weekdays' }, ...['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(x => F({ w: 36, h: 28, main: 'center', cross: 'center' }, T(x, { s: 12, c: '$textMuted', w: 600 })))), ...rows);
  });
  set(pg, 'OTP Input', { Length: ['4', '6'], State: ['Empty', 'Filled', 'Error'] }, v => row({ name: 'OTP Input', gap: 8 }, ...Array.from({ length: Number(v.Length) }, (_, i) =>
    F({ name: 'Digit', w: 44, h: 52, main: 'center', cross: 'center', r: 'md', fill: '$surface', stroke: v.State === 'Error' ? '$danger' : v.State === 'Empty' && i === 0 ? '$primary' : '$borderStrong', sw: v.State === 'Empty' && i === 0 ? 2 : 1 }, v.State === 'Empty' ? false : T(String((i * 3 + 2) % 10), { s: 20, w: 600 })))));
  set(pg, 'File Upload', { State: ['Default', 'Active', 'Error'] }, v => col({ name: 'File Upload', w: 320, h: 160, main: 'center', cross: 'center', gap: 6, r: 'lg', fill: v.State === 'Active' ? '$secondary' : '$surface', stroke: v.State === 'Error' ? '$danger' : v.State === 'Active' ? '$primary' : '$borderStrong', dash: [6, 4] },
    Ic('ul', 24, v.State === 'Error' ? '$danger' : '$primary'), T(v.State === 'Error' ? 'File is too large' : 'Drag & drop files here', { s: 14, w: 600, c: v.State === 'Error' ? '$danger' : '$text' }), T('or click to browse', { s: 12, c: '$textMuted' })));

  // ================= Selection controls =================
  pg = page('Selection');
  set(pg, 'Checkbox', { State: ['Unchecked', 'Checked', 'Indeterminate'], Disabled: ['No', 'Yes'] }, v => { const dis = v.Disabled === 'Yes';
    return row({ name: 'Checkbox', gap: 10 }, checkBox(v.State === 'Checked', v.State === 'Indeterminate', dis), T('Label', { s: 14, c: dis ? '$textDisabled' : '$text', prop: 'Label' })); });
  set(pg, 'Radio', { Selected: ['No', 'Yes'], Disabled: ['No', 'Yes'] }, v => { const on = v.Selected === 'Yes', dis = v.Disabled === 'Yes';
    return row({ name: 'Radio', gap: 10 }, F({ name: 'Dot', w: 20, h: 20, main: 'center', cross: 'center', r: 10, fill: dis ? '$disabledBg' : '$surface', stroke: dis ? '$border' : on ? '$primary' : '$borderStrong', sw: 1.5 }, on ? circle(10, dis ? '$textDisabled' : '$primary') : false), T('Label', { s: 14, c: dis ? '$textDisabled' : '$text', prop: 'Label' })); });
  set(pg, 'Switch', { State: ['Off', 'On'], Disabled: ['No', 'Yes'] }, v => { const on = v.State === 'On', dis = v.Disabled === 'Yes';
    return row({ name: 'Switch', gap: 10 }, F({ name: 'Track', w: 44, h: 24, pad: 2, cross: 'center', main: on ? 'end' : 'start', r: 12, fill: dis ? '$disabledBg' : on ? '$primary' : '$borderStrong' }, circle(20, '#FFFFFF', { shadow: 'sm', name: 'Knob' })), T('Label', { s: 14, c: dis ? '$textDisabled' : '$text', prop: 'Label' })); });
  set(pg, 'Rating', { Value: ['0', '1', '2', '3', '4', '5'] }, v => row({ name: 'Rating', gap: 4 }, ...[1, 2, 3, 4, 5].map(i => Ic(i <= Number(v.Value) ? 'star' : 'starO', 24, i <= Number(v.Value) ? '#F59E0B' : '$borderStrong'))));
  set(pg, 'Option Card', { Selected: ['No', 'Yes'] }, v => { const on = v.Selected === 'Yes';
    return row({ name: 'Option Card', w: 300, pad: 16, gap: 12, r: 'lg', fill: on ? '$secondary' : '$surface', stroke: on ? '$primary' : '$border', sw: on ? 2 : 1 },
      F({ w: 20, h: 20, main: 'center', cross: 'center', r: 10, stroke: on ? '$primary' : '$borderStrong', sw: 1.5 }, on ? circle(10, '$primary') : false),
      col({ w: 'fill', gap: 2 }, T('Pro plan', { s: 14, w: 600, prop: 'Title' }), T('Unlimited projects and members', { s: 12, c: '$textMuted', fw: 'fill', prop: 'Description' })), T('$12', { s: 14, w: 600 })); });

  // ================= Navigation =================
  pg = page('Navigation');
  set(pg, 'Navbar', { Type: ['Desktop', 'Mobile'] }, v => v.Type === 'Desktop'
    ? row({ name: 'Navbar', w: 1200, h: 64, pad: [0, 32], gap: 32, fill: '$surface', stroke: '$border' }, row({ gap: 8 }, F({ w: 28, h: 28, r: 8, fill: '$primary' }), T('Brand', { s: 18, w: 700, prop: 'Brand' })),
      row({ gap: 24, w: 'fill' }, ...['Product', 'Solutions', 'Pricing', 'Docs'].map((t, i) => T(t, { s: 14, w: 500, c: i === 0 ? '$primary' : '$textMuted' }))),
      row({ gap: 12 }, T('Log in', { s: 14, w: 600 }), F({ h: 36, pad: [0, 16], main: 'center', cross: 'center', r: 'md', fill: '$primary' }, T('Sign up', { s: 14, w: 600, c: '$onPrimary' }))))
    : row({ name: 'Navbar', w: 375, h: 56, pad: [0, 16], main: 'between', fill: '$surface', stroke: '$border' }, T('Brand', { s: 18, w: 700, prop: 'Brand' }), Ic('menu', 22)));
  set(pg, 'Top App Bar', { Type: ['Small', 'Center', 'Large'] }, v => v.Type === 'Large'
    ? col({ name: 'Top App Bar', w: 375, pad: [12, 16, 16, 16], gap: 20, fill: '$surface' }, row({ w: 'fill', main: 'between' }, Ic('back', 22), Ic('dots', 22)), T('Page title', { s: 28, w: 700, prop: 'Title' }))
    : row({ name: 'Top App Bar', w: 375, h: 56, pad: [0, 16], gap: 16, fill: '$surface', main: v.Type === 'Center' ? 'between' : 'start' }, Ic('back', 22), T('Page title', { s: 18, w: 600, prop: 'Title' }), v.Type === 'Center' ? Ic('dots', 22) : false));
  set(pg, 'Bottom Navigation', { Items: ['3', '4', '5'] }, v => row({ name: 'Bottom Navigation', w: 375, h: 64, main: 'between', pad: [0, 12], fill: '$surface', stroke: '$border' },
    ...['Home', 'Search', 'Inbox', 'Saved', 'Profile'].slice(0, Number(v.Items)).map((t, i) => col({ name: 'Tab', w: 'fill', cross: 'center', gap: 4 }, F({ w: 24, h: 24, r: 7, stroke: i === 0 ? '$primary' : '$textMuted', sw: 1.8, fill: i === 0 ? '$primary/15' : undefined }), T(t, { s: 11, w: 600, c: i === 0 ? '$primary' : '$textMuted' })))));
  set(pg, 'Tabs', { Style: ['Underline', 'Pill'], Items: ['3', '4'] }, v => {
    const items = ['Overview', 'Activity', 'Settings', 'Billing'].slice(0, Number(v.Items));
    return row({ name: 'Tabs', gap: v.Style === 'Pill' ? 4 : 0 }, ...items.map((t, i) => v.Style === 'Underline'
      ? col({ name: 'Tab', gap: 0 }, F({ h: 40, pad: [0, 16], cross: 'center' }, T(t, { s: 14, w: i === 0 ? 600 : 500, c: i === 0 ? '$primary' : '$textMuted' })), R({ w: 'fill', h: 2, fill: i === 0 ? '$primary' : '$border' }))
      : F({ name: 'Tab', h: 36, pad: [0, 16], main: 'center', cross: 'center', r: 18, fill: i === 0 ? '$primary' : undefined }, T(t, { s: 14, w: 600, c: i === 0 ? '$onPrimary' : '$textMuted' }))));
  });
  set(pg, 'Breadcrumb', { Levels: ['2', '3', '4'] }, v => row({ name: 'Breadcrumb', gap: 8 }, ...['Home', 'Products', 'Shoes', 'Sneaker'].slice(0, Number(v.Levels)).flatMap((t, i, a): Kid[] => [T(t, { s: 13, c: i === a.length - 1 ? '$text' : '$textMuted', w: i === a.length - 1 ? 600 : 400 }), i < a.length - 1 ? Ic('right', 14, '$textMuted') : false])));
  set(pg, 'Pagination', { Style: ['Numbered', 'Simple'] }, v => v.Style === 'Numbered'
    ? row({ name: 'Pagination', gap: 4 }, Ic('left', 18, '$textMuted'), ...['1', '2', '3', '…', '9'].map((t, i) => F({ w: 36, h: 36, main: 'center', cross: 'center', r: 'md', fill: i === 1 ? '$primary' : undefined }, T(t, { s: 13, w: 600, c: i === 1 ? '$onPrimary' : '$text' }))), Ic('right', 18))
    : row({ name: 'Pagination', gap: 16 }, F({ h: 36, pad: [0, 14], main: 'center', cross: 'center', r: 'md', stroke: '$borderStrong' }, T('Previous', { s: 13, w: 600 })), T('Page 2 of 9', { s: 13, c: '$textMuted' }), F({ h: 36, pad: [0, 14], main: 'center', cross: 'center', r: 'md', stroke: '$borderStrong' }, T('Next', { s: 13, w: 600 }))));
  set(pg, 'Stepper', { Steps: ['3', '4', '5'] }, v => { const n = Number(v.Steps);
    return row({ name: 'Stepper', gap: 8 }, ...Array.from({ length: n }, (_, i) => row({ gap: 8 }, F({ w: 28, h: 28, main: 'center', cross: 'center', r: 14, fill: i <= 1 ? '$primary' : '$surfaceAlt', stroke: i === 1 ? undefined : undefined }, i < 1 ? Ic('check', 13, '$onPrimary') : T(String(i + 1), { s: 12, w: 700, c: i === 1 ? '$onPrimary' : '$textMuted' })),
      T(['Account', 'Profile', 'Plan', 'Review', 'Done'][i], { s: 13, w: 600, c: i <= 1 ? '$text' : '$textMuted' }), i < n - 1 ? R({ w: 32, h: 2, fill: i < 1 ? '$primary' : '$border' }) : false))); });
  set(pg, 'Nav Item', { State: ['Default', 'Hover', 'Active', 'Disabled'] }, v => row({ name: 'Nav Item', w: 220, h: 40, pad: [0, 12], gap: 12, r: 'md', fill: v.State === 'Active' ? '$secondary' : v.State === 'Hover' ? '$surfaceAlt' : undefined },
    F({ w: 18, h: 18, r: 5, stroke: v.State === 'Active' ? '$onSecondary' : v.State === 'Disabled' ? '$textDisabled' : '$textMuted', sw: 1.6 }), T('Dashboard', { s: 14, w: v.State === 'Active' ? 600 : 500, c: v.State === 'Active' ? '$onSecondary' : v.State === 'Disabled' ? '$textDisabled' : '$text', prop: 'Label' })));
  set(pg, 'Sidebar', { State: ['Expanded', 'Collapsed'] }, v => { const ex = v.State === 'Expanded';
    return col({ name: 'Sidebar', w: ex ? 248 : 72, h: 560, pad: 12, gap: 4, fill: '$surface', stroke: '$border', cross: ex ? 'start' : 'center' }, row({ h: 48, gap: 8, pad: [0, 4] }, F({ w: 28, h: 28, r: 8, fill: '$primary' }), ex ? T('Brand', { s: 16, w: 700 }) : false),
      ...['Dashboard', 'Projects', 'Messages', 'Reports', 'Settings'].map((t, i) => row({ h: 40, w: ex ? 'fill' : 40, pad: ex ? [0, 12] : 0, gap: 12, main: ex ? 'start' : 'center', r: 'md', fill: i === 0 ? '$secondary' : undefined }, F({ w: 18, h: 18, r: 5, stroke: i === 0 ? '$onSecondary' : '$textMuted', sw: 1.6 }), ex ? T(t, { s: 14, w: i === 0 ? 600 : 500, c: i === 0 ? '$onSecondary' : '$text' }) : false))); });
  comp(pg, 'Footer', () => row({ name: 'Footer', w: 1200, pad: [48, 32], gap: 64, fill: '$surfaceAlt', main: 'between', cross: 'start' },
    col({ gap: 12 }, row({ gap: 8 }, F({ w: 28, h: 28, r: 8, fill: '$primary' }), T('Brand', { s: 18, w: 700 })), T('Build better products, faster.', { s: 13, c: '$textMuted', fw: 240 })),
    ...[['Product', 'Features', 'Pricing', 'Changelog'], ['Company', 'About', 'Careers', 'Contact'], ['Legal', 'Privacy', 'Terms', 'Cookies']].map(c => col({ gap: 10 }, T(c[0], { s: 13, w: 700 }), ...c.slice(1).map(t => T(t, { s: 13, c: '$textMuted' }))))));
  set(pg, 'Tree Item', { State: ['Collapsed', 'Expanded', 'Selected'] }, v => row({ name: 'Tree Item', w: 240, h: 32, pad: [0, 8], gap: 6, r: 6, fill: v.State === 'Selected' ? '$secondary' : undefined }, Ic(v.State === 'Expanded' ? 'down' : 'right', 12, '$textMuted'), F({ w: 16, h: 14, r: 3, fill: '$warning' }), T('folder', { s: 13, w: v.State === 'Selected' ? 600 : 400 })));

  // ================= Data display =================
  pg = page('Data Display');
  set(pg, 'Card', { Style: ['Elevated', 'Outlined', 'Filled'], Layout: ['Vertical', 'Horizontal'] }, v => {
    const body = col({ w: 'fill', pad: 16, gap: 8 }, T('Card title', { s: 16, w: 600, prop: 'Title' }), T(lorem, { s: 13, c: '$textMuted', fw: 'fill', prop: 'Description' }), row({ gap: 8, pad: [8, 0, 0, 0] }, F({ h: 32, pad: [0, 12], main: 'center', cross: 'center', r: 'md', fill: '$primary' }, T('Action', { s: 13, w: 600, c: '$onPrimary' })), F({ h: 32, pad: [0, 12], main: 'center', cross: 'center' }, T('Cancel', { s: 13, w: 600, c: '$primary' }))));
    const o = { name: 'Card', r: 'lg' as const, clip: true, fill: v.Style === 'Filled' ? '$surfaceAlt' : '$surface', stroke: v.Style === 'Outlined' ? '$border' : undefined, shadow: v.Style === 'Elevated' ? ('md' as const) : undefined };
    return v.Layout === 'Vertical' ? col({ ...o, w: 300 }, imagePh('fill', 140), body) : row({ ...o, w: 440, cross: 'start' }, imagePh(140, 160), body);
  });
  set(pg, 'Avatar', { Size: ['24', '32', '40', '56', '80'], Type: ['Initials', 'Image', 'Icon'] }, v => { const d = Number(v.Size);
    return v.Type === 'Initials' ? avatar(d, 'AK') : v.Type === 'Image' ? F({ name: 'Avatar', w: d, h: d, r: d / 2, clip: true, fill: '$surfaceAlt', main: 'center', cross: 'center' }, circle(d * 0.4, '$borderStrong', { name: 'Head' })) : F({ name: 'Avatar', w: d, h: d, r: d / 2, fill: '$secondary', main: 'center', cross: 'center' }, Ic('user', d * 0.5, '$onSecondary')); });
  set(pg, 'Avatar Group', { Count: ['3', '4', '5'] }, v => row({ name: 'Avatar Group', gap: -10 }, ...Array.from({ length: Number(v.Count) }, (_, i) => F({ name: 'Avatar', w: 36, h: 36, main: 'center', cross: 'center', r: 18, fill: ['$secondary', '$successSoft', '$warningSoft', '$infoSoft', '$dangerSoft'][i], stroke: '$surface', sw: 2 }, T('ABCDE'[i], { s: 13, w: 600 })))));
  set(pg, 'Badge', { Color: ['Neutral', 'Primary', 'Success', 'Warning', 'Danger', 'Info'], Style: ['Soft', 'Solid'] }, v => {
    const m: Record<string, [string, string, string]> = { Neutral: ['$surfaceAlt', '$text', '$textMuted'], Primary: ['$secondary', '$onSecondary', '$primary'], Success: ['$successSoft', '$success', '$success'], Warning: ['$warningSoft', '$warning', '$warning'], Danger: ['$dangerSoft', '$danger', '$danger'], Info: ['$infoSoft', '$info', '$info'] };
    const [soft, fg, solid] = m[v.Color]; const s = v.Style === 'Solid';
    return row({ name: 'Badge', h: 22, pad: [0, 10], gap: 6, r: 11, fill: s ? (v.Color === 'Neutral' ? '$inverse' : solid) : soft }, T(v.Color, { s: 12, w: 600, c: s ? (v.Color === 'Neutral' ? '$onInverse' : '#FFFFFF') : fg, prop: 'Label' }));
  });
  set(pg, 'Notification Badge', { Type: ['Dot', 'Count', 'Overflow'] }, v => v.Type === 'Dot' ? circle(10, '$danger', { name: 'Dot' }) : F({ name: 'Count', h: 20, w: v.Type === 'Count' ? 20 : 28, main: 'center', cross: 'center', r: 10, fill: '$danger' }, T(v.Type === 'Count' ? '3' : '99+', { s: 11, w: 700, c: '#FFFFFF', prop: 'Count' })));
  set(pg, 'List Item', { Type: ['One line', 'Two line', 'Avatar', 'Switch', 'Checkbox', 'Chevron'] }, v => {
    const lead: N | false = v.Type === 'Avatar' ? avatar(40, 'JD') : v.Type === 'Checkbox' ? checkBox(true, false, false) : false;
    const trail: N | false = v.Type === 'Switch' ? F({ w: 44, h: 24, pad: 2, cross: 'center', main: 'end', r: 12, fill: '$primary' }, circle(20, '#FFFFFF')) : v.Type === 'Chevron' ? Ic('right', 20, '$textMuted') : false;
    return row({ name: 'List Item', w: 360, pad: [12, 16], gap: 16, fill: '$surface' }, lead, col({ w: 'fill', gap: 2 }, T('List item', { s: 15, w: 500, prop: 'Title' }), v.Type === 'One line' ? false : T('Supporting text', { s: 13, c: '$textMuted', prop: 'Subtitle' })), trail);
  });
  set(pg, 'Table Row', { State: ['Default', 'Hover', 'Selected'] }, v => row({ name: 'Table Row', w: 640, h: 52, pad: [0, 16], gap: 16, fill: v.State === 'Selected' ? '$secondary' : v.State === 'Hover' ? '$surfaceAlt' : '$surface' },
    checkBox(v.State === 'Selected', false, false), row({ w: 'fill', gap: 10 }, avatar(28, 'AB'), T('Ada Byron', { s: 14, w: 500 })), T('Engineer', { s: 14, c: '$textMuted', fw: 120 }), F({ w: 90 }, row({ h: 22, pad: [0, 10], r: 11, fill: '$successSoft' }, T('Active', { s: 12, w: 600, c: '$success' }))), Ic('dots', 18, '$textMuted')));
  comp(pg, 'Table', () => {
    const hdr = row({ name: 'Header', w: 'fill', h: 44, pad: [0, 16], gap: 16, fill: '$surfaceAlt' }, F({ w: 20 }), T('Name', { s: 12, w: 700, c: '$textMuted', fw: 'fill', case: 'UPPER' }), T('Role', { s: 12, w: 700, c: '$textMuted', fw: 120, case: 'UPPER' }), T('Status', { s: 12, w: 700, c: '$textMuted', fw: 90, case: 'UPPER' }), F({ w: 18 }));
    const rows = [['Ada Byron', 'Engineer', 'Active'], ['Grace Hopper', 'Admiral', 'Active'], ['Alan Turing', 'Researcher', 'Invited'], ['Linus T.', 'Maintainer', 'Active']].map(r => row({ name: 'Row', w: 'fill', h: 52, pad: [0, 16], gap: 16 }, checkBox(false, false, false), T(r[0], { s: 14, w: 500, fw: 'fill' }), T(r[1], { s: 14, c: '$textMuted', fw: 120 }), T(r[2], { s: 13, w: 600, c: r[2] === 'Active' ? '$success' : '$warning', fw: 90 }), Ic('dots', 18, '$textMuted')));
    const items: N[] = [hdr]; rows.forEach((r, i) => { items.push(r); if (i < rows.length - 1) items.push(Div()); });
    return col({ name: 'Table', w: 640, r: 'lg', stroke: '$border', fill: '$surface', clip: true }, ...items);
  });
  set(pg, 'Stat Card', { Trend: ['Up', 'Down', 'Neutral'] }, v => col({ name: 'Stat Card', w: 240, pad: 20, gap: 8, r: 'lg', fill: '$surface', stroke: '$border' }, T('Total revenue', { s: 13, c: '$textMuted', prop: 'Label' }), T('$48,290', { s: 28, w: 700, prop: 'Value' }),
    row({ gap: 6 }, Ic(v.Trend === 'Up' ? 'up' : v.Trend === 'Down' ? 'down' : 'minus', 12, v.Trend === 'Up' ? '$success' : v.Trend === 'Down' ? '$danger' : '$textMuted'), T(v.Trend === 'Up' ? '12.5%' : v.Trend === 'Down' ? '4.1%' : '0.0%', { s: 13, w: 600, c: v.Trend === 'Up' ? '$success' : v.Trend === 'Down' ? '$danger' : '$textMuted' }), T('vs last month', { s: 12, c: '$textMuted' }))));
  set(pg, 'Accordion', { State: ['Collapsed', 'Expanded'] }, v => col({ name: 'Accordion', w: 400, r: 'lg', stroke: '$border', fill: '$surface' }, row({ w: 'fill', h: 56, pad: [0, 16], main: 'between' }, T('What is a design system?', { s: 15, w: 600, prop: 'Title' }), Ic(v.State === 'Expanded' ? 'up' : 'down', 14, '$textMuted')),
    v.State === 'Expanded' ? col({ w: 'fill', pad: [0, 16, 16, 16] }, T(lorem, { s: 14, c: '$textMuted', fw: 'fill', prop: 'Content' })) : false));
  set(pg, 'Divider', { Direction: ['Horizontal', 'Vertical'], Style: ['Solid', 'Dashed'] }, v => { const h = v.Direction === 'Horizontal';
    return v.Style === 'Dashed' ? F({ name: 'Divider', w: h ? 240 : 1, h: h ? 1 : 80, stroke: '$borderStrong', dash: [4, 4] }) : R({ name: 'Divider', w: h ? 240 : 1, h: h ? 1 : 80, fill: '$border' }); });
  set(pg, 'Tooltip', { Position: ['Top', 'Bottom', 'Left', 'Right'] }, v => {
    const tip = F({ name: 'Tip', h: 28, pad: [0, 10], main: 'center', cross: 'center', r: 6, fill: '$inverse' }, T('Tooltip text', { s: 12, w: 500, c: '$onInverse', prop: 'Text' }));
    const arrow = R({ name: 'Arrow', w: 8, h: 8, fill: '$inverse' }); arrow.n.rotation = 45;
    const h = v.Position === 'Left' || v.Position === 'Right';
    return F({ name: 'Tooltip', dir: h ? 'row' : 'col', cross: 'center', gap: -3 }, v.Position === 'Top' || v.Position === 'Left' ? tip : arrow, v.Position === 'Top' || v.Position === 'Left' ? arrow : tip);
  });
  set(pg, 'Skeleton', { Type: ['Text', 'Title', 'Avatar', 'Image', 'Card'] }, v => { const sk = (w: number | 'fill', h: number, r = 6) => R({ name: 'Skeleton', w, h, r, fill: '$surfaceAlt' });
    return v.Type === 'Text' ? col({ gap: 8 }, sk(280, 12), sk(280, 12), sk(180, 12)) : v.Type === 'Title' ? sk(200, 24) : v.Type === 'Avatar' ? sk(48, 48, 24) : v.Type === 'Image' ? sk(280, 160, 12)
      : col({ w: 280, pad: 16, gap: 12, r: 'lg', stroke: '$border' }, row({ gap: 12 }, sk(40, 40, 20), col({ gap: 6 }, sk(120, 12), sk(80, 10))), sk('fill', 100, 8), sk('fill', 12), sk(160, 12)); });
  set(pg, 'Timeline Item', { Status: ['Done', 'Current', 'Upcoming'] }, v => row({ name: 'Timeline Item', gap: 16, cross: 'start' },
    col({ cross: 'center', gap: 4 }, F({ w: 20, h: 20, main: 'center', cross: 'center', r: 10, fill: v.Status === 'Done' ? '$success' : v.Status === 'Current' ? '$surface' : '$surfaceAlt', stroke: v.Status === 'Current' ? '$primary' : undefined, sw: 3 }, v.Status === 'Done' ? Ic('check', 11, '#FFFFFF') : false), R({ w: 2, h: 32, fill: '$border' })),
    col({ gap: 2 }, T('Order placed', { s: 14, w: 600, c: v.Status === 'Upcoming' ? '$textMuted' : '$text', prop: 'Title' }), T('Nov 14, 9:41 AM', { s: 12, c: '$textMuted', prop: 'Time' }))));
  set(pg, 'Image', { Ratio: ['1:1', '4:3', '16:9'] }, v => { const w = 280, h = { '1:1': 280, '4:3': 210, '16:9': 158 }[v.Ratio]!; return F({ name: 'Image', w, h, main: 'center', cross: 'center', r: 'lg', fill: '$surfaceAlt' }, T(v.Ratio, { s: 14, c: '$textMuted', w: 600 })); });
  set(pg, 'Chart', { Type: ['Bar', 'Line', 'Donut'] }, v => {
    const box = (c: N) => col({ name: 'Chart', w: 300, pad: 16, gap: 12, r: 'lg', fill: '$surface', stroke: '$border' }, T('Weekly activity', { s: 14, w: 600, prop: 'Title' }), c);
    if (v.Type === 'Bar') return box(row({ h: 140, w: 'fill', gap: 12, cross: 'end', main: 'between' }, ...[60, 90, 50, 120, 80, 100, 70].map((h, i) => R({ w: 24, h, r: [4, 4, 0, 0], fill: i === 3 ? '$primary' : '$secondary' }))));
    if (v.Type === 'Line') return box(V(268, 140, [[0, 110], [45, 70], [90, 90], [135, 30], [180, 60], [225, 20], [268, 40]], { c: '$primary', sw: 3 }));
    return box(F({ w: 'fill', main: 'center' }, F({ name: 'Donut', w: 140, h: 140, main: 'center', cross: 'center' }, ringLayer(140, 0.72, 16, '$primary'), T('72%', { s: 26, w: 700, abs: { x: 42, y: 52 } }))));
  });
  comp(pg, 'Code Block', () => col({ name: 'Code Block', w: 420, pad: 16, gap: 4, r: 'lg', fill: '#0F172A' }, T('const system = createDesignSystem();', { s: 13, c: '#E2E8F0', mono: true }), T('system.link(file);', { s: 13, c: '#93C5FD', mono: true })));

  // ================= Feedback =================
  pg = page('Feedback');
  set(pg, 'Alert', { Type: ['Info', 'Success', 'Warning', 'Error'], Layout: ['Inline', 'With action'] }, v => {
    const m = { Info: ['$infoSoft', '$info', 'info'], Success: ['$successSoft', '$success', 'check'], Warning: ['$warningSoft', '$warning', 'warn'], Error: ['$dangerSoft', '$danger', 'close'] }[v.Type]!;
    return row({ name: 'Alert', w: 420, pad: 14, gap: 12, r: 'lg', fill: m[0], cross: 'start', stroke: m[1] + '/40' }, Ic(m[2], 18, m[1]), col({ w: 'fill', gap: 2 }, T(`${v.Type} message`, { s: 14, w: 600, prop: 'Title' }), T('Something you should know about.', { s: 13, c: '$textMuted', fw: 'fill', prop: 'Description' })),
      v.Layout === 'With action' ? T('Undo', { s: 13, w: 700, c: m[1] }) : Ic('close', 14, '$textMuted'));
  });
  set(pg, 'Toast', { Type: ['Neutral', 'Success', 'Error'] }, v => row({ name: 'Toast', h: 48, pad: [0, 16], gap: 12, r: 'md', fill: '$inverse', shadow: 'lg' }, v.Type === 'Neutral' ? false : Ic(v.Type === 'Success' ? 'check' : 'close', 16, v.Type === 'Success' ? '$success' : '$danger'), T('Changes saved', { s: 14, c: '$onInverse', prop: 'Message' }), T('Undo', { s: 14, w: 700, c: '$primary' })));
  set(pg, 'Progress Bar', { Value: ['0', '25', '50', '75', '100'] }, v => { const w = 280, f = Number(v.Value) / 100;
    return col({ name: 'Progress Bar', w, gap: 6 }, row({ w: 'fill', main: 'between' }, T('Uploading', { s: 13, w: 500, prop: 'Label' }), T(`${v.Value}%`, { s: 13, c: '$textMuted' })), F({ w: 'fill', h: 8, r: 4, fill: '$surfaceAlt', clip: true }, f > 0 ? R({ w: Math.max(1, w * f), h: 8, fill: v.Value === '100' ? '$success' : '$primary' }) : false)); });
  set(pg, 'Spinner', { Size: ['S', 'M', 'L'] }, v => { const d = { S: 16, M: 24, L: 40 }[v.Size]!; return ringLayer(d, 0.28, Math.max(2, d / 8), '$primary', '$border'); });
  set(pg, 'Banner', { Type: ['Info', 'Promo', 'Cookie'] }, v => v.Type === 'Cookie'
    ? row({ name: 'Banner', w: 720, pad: 16, gap: 16, r: 'lg', fill: '$surface', stroke: '$border', shadow: 'lg' }, T('We use cookies to improve your experience.', { s: 14, fw: 'fill' }), F({ h: 36, pad: [0, 14], main: 'center', cross: 'center', r: 'md', stroke: '$borderStrong' }, T('Decline', { s: 13, w: 600 })), F({ h: 36, pad: [0, 14], main: 'center', cross: 'center', r: 'md', fill: '$primary' }, T('Accept', { s: 13, w: 600, c: '$onPrimary' })))
    : row({ name: 'Banner', w: 720, h: 44, pad: [0, 16], gap: 12, main: 'center', fill: v.Type === 'Info' ? '$infoSoft' : '$primary' }, T(v.Type === 'Info' ? 'Scheduled maintenance on Saturday 02:00 UTC.' : '🎉 New: Dark mode is here.', { s: 13, w: 600, c: v.Type === 'Info' ? '$info' : '$onPrimary', prop: 'Message' }), T('Learn more', { s: 13, w: 700, deco: 'UNDERLINE', c: v.Type === 'Info' ? '$info' : '$onPrimary' })));
  set(pg, 'Inline Message', { Type: ['Hint', 'Success', 'Error'] }, v => row({ name: 'Inline Message', gap: 6 }, Ic(v.Type === 'Hint' ? 'info' : v.Type === 'Success' ? 'check' : 'warn', 14, v.Type === 'Hint' ? '$textMuted' : v.Type === 'Success' ? '$success' : '$danger'), T({ Hint: 'Use at least 8 characters', Success: 'Looks good!', Error: 'Enter a valid email address' }[v.Type]!, { s: 13, c: v.Type === 'Hint' ? '$textMuted' : v.Type === 'Success' ? '$success' : '$danger', prop: 'Message' })));
  comp(pg, 'Empty State', () => col({ name: 'Empty State', w: 360, pad: 32, gap: 12, cross: 'center' }, F({ w: 72, h: 72, main: 'center', cross: 'center', r: 36, fill: '$surfaceAlt' }, Ic('mail', 28, '$textMuted')), T('No messages yet', { s: 18, w: 700, prop: 'Title' }), T('When you get new messages they will show up here.', { s: 14, c: '$textMuted', fw: 280, al: 'CENTER', prop: 'Description' }), F({ h: 40, pad: [0, 16], main: 'center', cross: 'center', r: 'md', fill: '$primary' }, T('Compose', { s: 14, w: 600, c: '$onPrimary' }))));

  // ================= Overlays =================
  pg = page('Overlays');
  set(pg, 'Modal', { Type: ['Confirm', 'Form', 'Destructive', 'Success'] }, v => {
    const t = { Confirm: 'Confirm action', Form: 'Create project', Destructive: 'Delete project?', Success: 'All done!' }[v.Type]!;
    const dang = v.Type === 'Destructive';
    return col({ name: 'Modal', w: 420, pad: 24, gap: 16, r: 'xl', fill: '$surface', shadow: 'lg', cross: v.Type === 'Success' ? 'center' : 'start' },
      v.Type === 'Success' ? F({ w: 56, h: 56, main: 'center', cross: 'center', r: 28, fill: '$successSoft' }, Ic('check', 26, '$success')) : false,
      row({ w: 'fill', main: 'between' }, T(t, { s: 18, w: 700, prop: 'Title' }), v.Type === 'Success' ? false : Ic('close', 16, '$textMuted')),
      v.Type === 'Form' ? col({ w: 'fill', gap: 12 }, F({ w: 'fill', h: 44, pad: [0, 12], r: 'md', stroke: '$borderStrong', cross: 'center' }, T('Project name', { s: 14, c: '$textMuted' })), F({ w: 'fill', h: 44, pad: [0, 12], r: 'md', stroke: '$borderStrong', cross: 'center' }, T('Description', { s: 14, c: '$textMuted' })))
        : T(dang ? 'This will permanently delete the project and all of its files. This cannot be undone.' : 'Are you sure you want to continue?', { s: 14, c: '$textMuted', fw: 'fill', prop: 'Message', al: v.Type === 'Success' ? 'CENTER' : 'LEFT' }),
      row({ w: 'fill', gap: 8, main: v.Type === 'Success' ? 'center' : 'end' }, v.Type === 'Success' ? false : F({ h: 40, pad: [0, 16], main: 'center', cross: 'center', r: 'md', stroke: '$borderStrong' }, T('Cancel', { s: 14, w: 600 })), F({ h: 40, pad: [0, 16], main: 'center', cross: 'center', r: 'md', fill: dang ? '$danger' : '$primary' }, T(dang ? 'Delete' : v.Type === 'Success' ? 'Continue' : 'Confirm', { s: 14, w: 600, c: dang ? '#FFFFFF' : '$onPrimary' }))));
  });
  set(pg, 'Bottom Sheet', { Type: ['Standard', 'Actions'] }, v => col({ name: 'Bottom Sheet', w: 375, pad: [12, 16, 24, 16], gap: 16, r: [24, 24, 0, 0], fill: '$surface', shadow: 'lg', cross: 'center' }, R({ w: 40, h: 4, r: 2, fill: '$borderStrong' }),
    v.Type === 'Standard' ? col({ w: 'fill', gap: 8 }, T('Sheet title', { s: 18, w: 700, prop: 'Title' }), T(lorem, { s: 14, c: '$textMuted', fw: 'fill' }))
      : col({ w: 'fill', gap: 0 }, ...['Share', 'Duplicate', 'Move', 'Delete'].flatMap((t, i): Kid[] => [row({ w: 'fill', h: 52, gap: 16 }, F({ w: 22, h: 22, r: 6, stroke: i === 3 ? '$danger' : '$textMuted', sw: 1.6 }), T(t, { s: 16, w: 500, c: i === 3 ? '$danger' : '$text' })), i < 3 ? Div() : false]))));
  set(pg, 'Side Drawer', { Side: ['Left', 'Right'] }, v => col({ name: 'Side Drawer', w: 320, h: 560, pad: 20, gap: 16, fill: '$surface', shadow: 'lg', stroke: '$border' }, row({ w: 'fill', main: 'between' }, T('Drawer', { s: 18, w: 700, prop: 'Title' }), Ic('close', 16, '$textMuted')), ...['Overview', 'Members', 'Billing', 'Integrations'].map(t => row({ w: 'fill', h: 40, pad: [0, 8], r: 'md' }, T(t, { s: 14, w: 500 }))), F({ h: 'fill', w: 'fill' })));
  set(pg, 'Dropdown Menu', { Items: ['3', '5'] }, v => col({ name: 'Dropdown Menu', w: 220, pad: 6, r: 'lg', fill: '$surface', stroke: '$border', shadow: 'lg' },
    ...['Profile', 'Settings', 'Team', 'Billing', 'Sign out'].slice(0, Number(v.Items)).map((t, i, a) => row({ w: 'fill', h: 36, pad: [0, 10], gap: 10, r: 6, fill: i === 0 ? '$surfaceAlt' : undefined }, F({ w: 16, h: 16, r: 4, stroke: '$textMuted', sw: 1.5 }), T(t, { s: 14, c: i === a.length - 1 && a.length > 3 ? '$danger' : '$text', prop: i === 0 ? 'First item' : undefined })))));
  set(pg, 'Menu Item', { State: ['Default', 'Hover', 'Selected', 'Disabled'] }, v => row({ name: 'Menu Item', w: 220, h: 36, pad: [0, 10], gap: 10, r: 6, fill: v.State === 'Hover' ? '$surfaceAlt' : v.State === 'Selected' ? '$secondary' : undefined }, T('Menu item', { s: 14, c: v.State === 'Disabled' ? '$textDisabled' : v.State === 'Selected' ? '$onSecondary' : '$text', prop: 'Label' }), F({ w: 'fill' }), v.State === 'Selected' ? Ic('check', 14, '$onSecondary') : T('⌘K', { s: 12, c: '$textMuted' })));
  comp(pg, 'Popover', () => col({ name: 'Popover', w: 280, pad: 16, gap: 8, r: 'lg', fill: '$surface', stroke: '$border', shadow: 'lg' }, T('Popover title', { s: 14, w: 700, prop: 'Title' }), T('Short helpful content shown next to its trigger.', { s: 13, c: '$textMuted', fw: 'fill' }), F({ h: 32, pad: [0, 12], main: 'center', cross: 'center', r: 'md', fill: '$primary' }, T('Got it', { s: 13, w: 600, c: '$onPrimary' }))));
  comp(pg, 'Action Sheet (iOS)', () => col({ name: 'Action Sheet', w: 359, gap: 8 }, col({ w: 'fill', r: 14, fill: '$surface' }, F({ w: 'fill', h: 44, main: 'center', cross: 'center' }, T('Choose an action', { s: 13, c: '$textMuted', w: 600 })), Div(), F({ w: 'fill', h: 56, main: 'center', cross: 'center' }, T('Take photo', { s: 20, c: '$info' })), Div(), F({ w: 'fill', h: 56, main: 'center', cross: 'center' }, T('Delete', { s: 20, c: '$danger' }))), F({ w: 'fill', h: 56, main: 'center', cross: 'center', r: 14, fill: '$surface' }, T('Cancel', { s: 20, w: 600, c: '$info' }))));
  comp(pg, 'Alert Dialog (iOS)', () => col({ name: 'Alert Dialog', w: 270, r: 14, fill: '$surface', cross: 'center' }, col({ w: 'fill', pad: 20, gap: 4, cross: 'center' }, T('Allow notifications?', { s: 17, w: 600, al: 'CENTER' }), T('We will only send what matters.', { s: 13, al: 'CENTER', c: '$textMuted', fw: 'fill' })), Div(), row({ w: 'fill', h: 44 }, F({ w: 'fill', h: 44, main: 'center', cross: 'center' }, T('Not now', { s: 17, c: '$info' })), Div({ v: true }), F({ w: 'fill', h: 44, main: 'center', cross: 'center' }, T('Allow', { s: 17, w: 600, c: '$info' })))));
  comp(pg, 'Command Palette', () => col({ name: 'Command Palette', w: 560, r: 'xl', fill: '$surface', stroke: '$border', shadow: 'lg', clip: true }, row({ w: 'fill', h: 52, pad: [0, 16], gap: 10 }, SearchIcon(18), T('Type a command or search…', { s: 15, c: '$textMuted' })), Div(),
    col({ w: 'fill', pad: 8, gap: 2 }, ...['New file', 'Open recent', 'Toggle theme', 'Share…'].map((t, i) => row({ w: 'fill', h: 38, pad: [0, 10], gap: 10, r: 8, fill: i === 0 ? '$secondary' : undefined }, F({ w: 18, h: 18, r: 5, stroke: '$textMuted', sw: 1.5 }), T(t, { s: 14, w: i === 0 ? 600 : 400 }), F({ w: 'fill' }), T(['⌘N', '⌘O', '⌘T', '⌘S'][i], { s: 12, c: '$textMuted' }))))));

  // ================= Platform (system chrome) =================
  pg = page('Platform');
  set(pg, 'iOS Status Bar', { Theme: ['Light', 'Dark'] }, v => { const c = v.Theme === 'Light' ? '#000000' : '#FFFFFF';
    return row({ name: 'iOS Status Bar', w: 390, h: 47, pad: [14, 28, 0, 28], main: 'between', fill: v.Theme === 'Light' ? '#FFFFFF' : '#000000' }, T('9:41', { s: 16, w: 600, c }), row({ gap: 6 }, ...[4, 6, 8, 10].map(h => R({ w: 3, h, r: 1, fill: c })), R({ w: 24, h: 12, r: 4, stroke: c, sw: 1 }))); });
  set(pg, 'iOS Navigation Bar', { Type: ['Inline', 'Large'] }, v => col({ name: 'iOS Navigation Bar', w: 390, pad: [8, 16, 8, 16], gap: 8, fill: '$surfaceAlt' }, row({ w: 'fill', h: 36, main: 'between' }, row({ gap: 2 }, Ic('left', 26, '$info'), T('Back', { s: 17, c: '$info' })), v.Type === 'Inline' ? T('Title', { s: 17, w: 600, prop: 'Title' }) : false, T('Edit', { s: 17, c: '$info' })), v.Type === 'Large' ? T('Title', { s: 34, w: 700, prop: 'Title' }) : false));
  comp(pg, 'iOS Tab Bar', () => row({ name: 'iOS Tab Bar', w: 390, h: 83, pad: [8, 12, 28, 12], main: 'between', fill: '$surfaceAlt', stroke: '$border' }, ...['Today', 'Games', 'Apps', 'Search'].map((t, i) => col({ w: 'fill', cross: 'center', gap: 3 }, F({ w: 26, h: 26, r: 8, fill: i === 0 ? '$info' : '$borderStrong' }), T(t, { s: 10, w: 500, c: i === 0 ? '$info' : '$textMuted' })))));
  comp(pg, 'iOS Home Indicator', () => F({ name: 'iOS Home Indicator', w: 390, h: 34, main: 'center', cross: 'end', pad: [0, 0, 8, 0] }, R({ w: 134, h: 5, r: 3, fill: '$text' })));
  set(pg, 'Android Status Bar', { Theme: ['Light', 'Dark'] }, v => { const c = v.Theme === 'Light' ? '#000000' : '#FFFFFF';
    return row({ name: 'Android Status Bar', w: 360, h: 24, pad: [0, 16], main: 'between', fill: v.Theme === 'Light' ? '#FFFFFF' : '#000000' }, T('12:30', { s: 12, w: 500, c }), row({ gap: 4 }, circle(8, c), R({ w: 14, h: 8, r: 2, fill: c }))); });
  set(pg, 'Android Navigation Bar', { Type: ['Gesture', '3-Button'] }, v => v.Type === 'Gesture'
    ? F({ name: 'Android Navigation Bar', w: 360, h: 24, main: 'center', cross: 'center', fill: '$surface' }, R({ w: 108, h: 4, r: 2, fill: '$text' }))
    : row({ name: 'Android Navigation Bar', w: 360, h: 48, main: 'center', gap: 64, fill: '$surface' }, Ic('left', 22), circle(18, '$text', { name: 'Home' }), R({ w: 16, h: 16, r: 3, stroke: '$text', sw: 2 })));
  set(pg, 'Material App Bar', { Type: ['Small', 'Medium'] }, v => v.Type === 'Small'
    ? row({ name: 'Material App Bar', w: 360, h: 64, pad: [0, 16], gap: 24, fill: '$surface' }, Ic('menu', 22), T('Title', { s: 22, prop: 'Title', w: 400 }), F({ w: 'fill' }), Ic('search', 22), Ic('dots', 22))
    : col({ name: 'Material App Bar', w: 360, pad: [8, 16, 20, 16], gap: 28, fill: '$surface' }, row({ w: 'fill', h: 48, gap: 24 }, Ic('menu', 22), F({ w: 'fill' }), Ic('search', 22), Ic('dots', 22)), T('Title', { s: 24, prop: 'Title' })));
  set(pg, 'Window Title Bar', { OS: ['macOS', 'Windows'] }, v => v.OS === 'macOS'
    ? row({ name: 'macOS Title Bar', w: 720, h: 38, pad: [0, 14], gap: 8, fill: '$surfaceAlt', stroke: '$border' }, circle(12, '#FF5F57'), circle(12, '#FEBC2E'), circle(12, '#28C840'), F({ w: 'fill', main: 'center' }, T('Untitled', { s: 13, w: 600, c: '$textMuted', prop: 'Title' })))
    : row({ name: 'Windows Title Bar', w: 720, h: 32, pad: [0, 0, 0, 12], gap: 8, fill: '$surfaceAlt', stroke: '$border' }, F({ w: 14, h: 14, r: 3, fill: '$info' }), T('Untitled', { s: 12, prop: 'Title' }), F({ w: 'fill' }), ...['−', '▢', '✕'].map(g => F({ w: 46, h: 32, main: 'center', cross: 'center' }, T(g, { s: 13 })))));
  comp(pg, 'Browser Window', () => col({ name: 'Browser Window', w: 960, h: 560, r: 'lg', fill: '$surface', stroke: '$borderStrong', clip: true },
    row({ w: 'fill', h: 40, pad: [0, 12, 0, 12], gap: 8, fill: '$surfaceAlt' }, circle(12, '#FF5F57'), circle(12, '#FEBC2E'), circle(12, '#28C840'), F({ w: 12 }), row({ h: 30, pad: [0, 14], gap: 8, r: [8, 8, 0, 0], fill: '$surface' }, T('New tab', { s: 12, w: 500 }), Ic('close', 10, '$textMuted'))),
    row({ w: 'fill', h: 44, pad: [0, 12], gap: 12, fill: '$surface', stroke: '$border' }, Ic('left', 18, '$textMuted'), Ic('right', 18, '$textMuted'), row({ w: 'fill', h: 30, pad: [0, 14], gap: 8, r: 15, fill: '$surfaceAlt' }, Ic('info', 12, '$textMuted'), T('https://example.com', { s: 13, c: '$textMuted' }))), F({ w: 'fill', h: 'fill' })));
  set(pg, 'Device Frame', { Device: ['Phone', 'Tablet', 'Laptop', 'Desktop'] }, v => { const [w, h, r] = { Phone: [375, 812, 44], Tablet: [768, 1024, 28], Laptop: [1280, 800, 14], Desktop: [1440, 900, 10] }[v.Device]!;
    return F({ name: 'Device Frame', w, h, r, fill: '$surface', stroke: '#1F2937', sw: 8 }); });

  // ================= Typography =================
  pg = page('Typography');
  const TY: [string, number, number, number][] = [['Display', 56, 700, -1], ['Heading 1', 40, 700, -0.5], ['Heading 2', 32, 700, -0.3], ['Heading 3', 24, 600, 0], ['Heading 4', 20, 600, 0], ['Heading 5', 18, 600, 0], ['Heading 6', 16, 600, 0], ['Body Large', 18, 400, 0], ['Body', 16, 400, 0], ['Body Small', 14, 400, 0], ['Caption', 12, 400, 0], ['Overline', 11, 700, 1.2], ['Label', 14, 600, 0], ['Code', 14, 400, 0]];
  set(pg, 'Text', { Style: TY.map(t => t[0]) }, v => { const t = TY.find(x => x[0] === v.Style)!; return F({ name: 'Text' }, T(v.Style === 'Overline' ? 'Overline text' : `${v.Style} — The quick brown fox`, { s: t[1], w: t[2], ls: t[3], mono: v.Style === 'Code', case: v.Style === 'Overline' ? 'UPPER' : undefined, prop: 'Text' })); });

  // ================= Patterns (ready-made blocks) =================
  pg = page('Patterns');
  const primaryBtn = (t: string, w: number | 'fill' | 'hug' = 'hug') => F({ w, h: 44, pad: [0, 20], main: 'center', cross: 'center', r: 'md', fill: '$primary' }, T(t, { s: 14, w: 600, c: '$onPrimary' }));
  const inputRow = (ph: string) => F({ w: 'fill', h: 44, pad: [0, 12], r: 'md', stroke: '$borderStrong', cross: 'center', fill: '$surface' }, T(ph, { s: 14, c: '$textMuted' }));
  comp(pg, 'Login Form', () => col({ name: 'Login Form', w: 380, pad: 32, gap: 20, r: 'xl', fill: '$surface', shadow: 'md' }, col({ gap: 4 }, T('Welcome back', { s: 24, w: 700, prop: 'Title' }), T('Sign in to your account', { s: 14, c: '$textMuted' })),
    col({ w: 'fill', gap: 14 }, col({ w: 'fill', gap: 6 }, T('Email', { s: 13, w: 600 }), inputRow('you@example.com')), col({ w: 'fill', gap: 6 }, row({ w: 'fill', main: 'between' }, T('Password', { s: 13, w: 600 }), T('Forgot?', { s: 13, w: 600, c: '$primary' })), inputRow('••••••••'))),
    primaryBtn('Sign in', 'fill'), row({ w: 'fill', gap: 12 }, Div(), T('or', { s: 12, c: '$textMuted' }), Div()), row({ w: 'fill', h: 44, gap: 10, main: 'center', r: 'md', stroke: '$borderStrong' }, circle(18, '#EA4335'), T('Continue with Google', { s: 14, w: 600 })),
    row({ w: 'fill', main: 'center', gap: 4 }, T('No account?', { s: 13, c: '$textMuted' }), T('Sign up', { s: 13, w: 700, c: '$primary' }))));
  comp(pg, 'Sign-up Form', () => col({ name: 'Sign-up Form', w: 380, pad: 32, gap: 20, r: 'xl', fill: '$surface', shadow: 'md' }, T('Create your account', { s: 24, w: 700, prop: 'Title' }),
    col({ w: 'fill', gap: 14 }, inputRow('Full name'), inputRow('Email address'), inputRow('Password')), row({ gap: 10 }, checkBox(true, false, false), T('I agree to the Terms and Privacy Policy', { s: 13, c: '$textMuted' })), primaryBtn('Create account', 'fill')));
  set(pg, 'Pricing Card', { Tier: ['Basic', 'Pro', 'Enterprise'] }, v => { const pro = v.Tier === 'Pro';
    return col({ name: 'Pricing Card', w: 300, pad: 28, gap: 20, r: 'xl', fill: '$surface', stroke: pro ? '$primary' : '$border', sw: pro ? 2 : 1, shadow: pro ? 'lg' : undefined }, row({ w: 'fill', main: 'between' }, T(v.Tier, { s: 18, w: 700, prop: 'Plan' }), pro ? row({ h: 22, pad: [0, 10], r: 11, fill: '$secondary' }, T('Popular', { s: 11, w: 700, c: '$onSecondary' })) : false),
      row({ gap: 4, cross: 'end' }, T({ Basic: '$0', Pro: '$29', Enterprise: '$99' }[v.Tier]!, { s: 40, w: 700, prop: 'Price' }), T('/month', { s: 14, c: '$textMuted' })), Div(),
      col({ gap: 10 }, ...['Unlimited projects', 'Team collaboration', v.Tier === 'Basic' ? 'Community support' : 'Priority support'].map(t => row({ gap: 8 }, Ic('check', 14, '$success'), T(t, { s: 14 })))), pro ? primaryBtn('Get started', 'fill') : F({ w: 'fill', h: 44, main: 'center', cross: 'center', r: 'md', stroke: '$borderStrong' }, T('Choose plan', { s: 14, w: 600 }))); });
  comp(pg, 'Hero Section', () => col({ name: 'Hero Section', w: 1200, pad: [96, 32], gap: 24, cross: 'center', fill: '$background' }, row({ h: 28, pad: [0, 12], r: 14, fill: '$secondary' }, T('New · Version 2.0', { s: 12, w: 600, c: '$onSecondary' })),
    T('Design faster with a system', { s: 56, w: 800, ls: -1.5, al: 'CENTER', prop: 'Headline', fw: 760 }), T('Reusable components, shared tokens and one source of truth for your whole product.', { s: 18, c: '$textMuted', al: 'CENTER', fw: 560, prop: 'Subhead' }),
    row({ gap: 12 }, primaryBtn('Get started'), F({ h: 44, pad: [0, 20], main: 'center', cross: 'center', r: 'md', stroke: '$borderStrong' }, T('Live demo', { s: 14, w: 600 })))));
  set(pg, 'Feature Card', { Layout: ['Icon top', 'Icon left'] }, v => { const ic = F({ w: 44, h: 44, main: 'center', cross: 'center', r: 'lg', fill: '$secondary' }, Ic('star', 20, '$onSecondary')), body = col({ w: 'fill', gap: 6 }, T('Fast by default', { s: 16, w: 700, prop: 'Title' }), T('Everything is optimised so you never wait.', { s: 14, c: '$textMuted', fw: 'fill', prop: 'Description' }));
    return v.Layout === 'Icon top' ? col({ name: 'Feature Card', w: 300, pad: 24, gap: 16, r: 'lg', fill: '$surface', stroke: '$border' }, ic, body) : row({ name: 'Feature Card', w: 380, pad: 24, gap: 16, r: 'lg', fill: '$surface', stroke: '$border', cross: 'start' }, ic, body); });
  comp(pg, 'Testimonial', () => col({ name: 'Testimonial', w: 380, pad: 24, gap: 16, r: 'xl', fill: '$surface', stroke: '$border' }, row({ gap: 2 }, ...Array.from({ length: 5 }, () => Ic('star', 16, '#F59E0B'))), T('“This design system cut our UI build time in half.”', { s: 16, w: 500, fw: 'fill', prop: 'Quote' }), row({ gap: 12 }, avatar(40, 'MR'), col({ gap: 1 }, T('Maria Rossi', { s: 14, w: 600, prop: 'Name' }), T('Head of Design', { s: 12, c: '$textMuted', prop: 'Role' })))));
  set(pg, 'Product Card', { State: ['Default', 'Sale'] }, v => col({ name: 'Product Card', w: 260, r: 'lg', fill: '$surface', stroke: '$border', clip: true }, F({ w: 'fill', h: 220, fill: '$surfaceAlt', pad: 12, main: 'between' }, v.State === 'Sale' ? row({ h: 24, pad: [0, 10], r: 12, fill: '$danger' }, T('-30%', { s: 12, w: 700, c: '#FFFFFF' })) : F({ w: 1 }), Ic('heart', 20, '$textMuted')),
    col({ w: 'fill', pad: 16, gap: 6 }, T('Everyday Sneaker', { s: 15, w: 600, prop: 'Title' }), row({ gap: 2 }, ...Array.from({ length: 5 }, () => Ic('star', 12, '#F59E0B'))), row({ gap: 8 }, T(v.State === 'Sale' ? '$63' : '$90', { s: 18, w: 700 }), v.State === 'Sale' ? T('$90', { s: 14, c: '$textMuted', deco: 'STRIKE' }) : false))));
  comp(pg, 'Profile Card', () => col({ name: 'Profile Card', w: 300, pad: 24, gap: 16, r: 'xl', fill: '$surface', stroke: '$border', cross: 'center' }, avatar(80, 'AK'), col({ cross: 'center', gap: 2 }, T('Akhil Kumar', { s: 18, w: 700, prop: 'Name' }), T('Product designer', { s: 13, c: '$textMuted', prop: 'Role' })), row({ gap: 24 }, ...[['128', 'Posts'], ['4.2k', 'Followers'], ['310', 'Following']].map(s => col({ cross: 'center' }, T(s[0], { s: 16, w: 700 }), T(s[1], { s: 12, c: '$textMuted' })))), primaryBtn('Follow', 'fill')));
  set(pg, 'Chat Bubble', { From: ['Received', 'Sent'] }, v => { const me = v.From === 'Sent';
    return col({ name: 'Chat Bubble', w: 320, cross: me ? 'end' : 'start', gap: 4 }, F({ pad: [10, 14], r: me ? [16, 16, 4, 16] : [16, 16, 16, 4], fill: me ? '$primary' : '$surfaceAlt', w: 'hug' }, T('Hey! Are we still on for today?', { s: 14, c: me ? '$onPrimary' : '$text', prop: 'Message', fw: 220 })), T('9:41 AM', { s: 11, c: '$textMuted' })); });
  comp(pg, 'Message Composer', () => row({ name: 'Message Composer', w: 420, h: 56, pad: [0, 12], gap: 10, r: 28, fill: '$surfaceAlt' }, Ic('plus', 20, '$textMuted'), T('Message…', { s: 14, c: '$textMuted' }), F({ w: 'fill' }), F({ w: 36, h: 36, main: 'center', cross: 'center', r: 18, fill: '$primary' }, Ic('fwd', 16, '$onPrimary'))));
  comp(pg, 'Comment', () => row({ name: 'Comment', w: 420, gap: 12, cross: 'start' }, avatar(36, 'JS'), col({ w: 'fill', gap: 6 }, row({ gap: 8 }, T('Jane Smith', { s: 14, w: 600, prop: 'Name' }), T('2h ago', { s: 12, c: '$textMuted' })), T('Love this direction — the spacing feels really consistent.', { s: 14, fw: 'fill', prop: 'Text' }), row({ gap: 16 }, T('Reply', { s: 12, w: 600, c: '$textMuted' }), T('♥ 12', { s: 12, w: 600, c: '$textMuted' })))));
  set(pg, 'Settings Row', { Type: ['Toggle', 'Link', 'Value'] }, v => row({ name: 'Settings Row', w: 400, h: 56, pad: [0, 16], gap: 12, fill: '$surface' }, F({ w: 28, h: 28, r: 7, fill: '$secondary' }), T('Notifications', { s: 15, w: 500, prop: 'Label' }), F({ w: 'fill' }),
    v.Type === 'Toggle' ? F({ w: 44, h: 24, pad: 2, cross: 'center', main: 'end', r: 12, fill: '$primary' }, circle(20, '#FFFFFF')) : v.Type === 'Link' ? Ic('right', 20, '$textMuted') : row({ gap: 6 }, T('English', { s: 14, c: '$textMuted' }), Ic('right', 18, '$textMuted'))));
  comp(pg, 'Newsletter Signup', () => row({ name: 'Newsletter Signup', w: 640, pad: 24, gap: 16, r: 'xl', fill: '$secondary', cross: 'center' }, col({ w: 'fill', gap: 4 }, T('Stay in the loop', { s: 20, w: 700, c: '$onSecondary', prop: 'Title' }), T('Product news, once a month.', { s: 14, c: '$onSecondary' })), F({ w: 220, h: 44, pad: [0, 12], r: 'md', fill: '$surface', cross: 'center' }, T('Email address', { s: 14, c: '$textMuted' })), primaryBtn('Subscribe')));
  comp(pg, 'Search Result', () => col({ name: 'Search Result', w: 560, gap: 4 }, T('example.com › docs › components', { s: 12, c: '$textMuted' }), T('Component library documentation', { s: 18, w: 500, c: '$info', prop: 'Title' }), T(lorem, { s: 14, c: '$textMuted', fw: 'fill' })));
  comp(pg, '404 Page', () => col({ name: '404 Page', w: 1200, h: 640, main: 'center', cross: 'center', gap: 16, fill: '$background' }, T('404', { s: 120, w: 800, c: '$primary', ls: -4 }), T('Page not found', { s: 24, w: 700, prop: 'Title' }), T('The page you are looking for does not exist or was moved.', { s: 16, c: '$textMuted', prop: 'Message' }), primaryBtn('Back to home')));

  // ================= MUI catalogue additions =================
  pg = page('MUI');
  const btnBox = (label: string, o: { fill?: string; fg?: string; stroke?: string; w?: number } = {}) => F({ name: 'Button', h: 36, w: o.w, pad: [0, 16], main: 'center', cross: 'center', fill: o.fill, stroke: o.stroke }, T(label, { s: 13, w: 600, c: o.fg ?? '$primary', case: 'UPPER' }));
  const listbox = (items: string[], hi = 0) => col({ name: 'Listbox', w: 'fill', pad: 4, r: 'md', fill: '$surface', stroke: '$border', shadow: 'md' }, ...items.map((t, i) => row({ w: 'fill', h: 36, pad: [0, 12], r: 6, fill: i === hi ? '$secondary' : undefined }, T(t, { s: 14 }))));
  const chipMini = (t: string) => row({ h: 24, pad: [0, 8], gap: 4, r: 12, fill: '$surfaceAlt' }, T(t, { s: 12 }), Ic('close', 10, '$textMuted'));
  const iconTile = (g: string, style: string) => F({ name: `Icon/${g}`, w: 44, h: 44, main: 'center', cross: 'center', r: 'md', fill: style === 'Filled' ? '$primary' : '$surfaceAlt', stroke: style === 'Outlined' ? '$borderStrong' : undefined }, Ic(g, 20, style === 'Filled' ? '$onPrimary' : '$text'));

  set(pg, 'Autocomplete', { State: ['Closed', 'Open', 'Multiple'] }, v => col({ name: 'Autocomplete', w: 300, gap: 4 },
    row({ w: 'fill', h: 48, pad: [0, 10], gap: 6, r: 'md', stroke: v.State === 'Closed' ? '$borderStrong' : '$primary', sw: v.State === 'Closed' ? 1 : 2, fill: '$surface' }, v.State === 'Multiple' ? row({ gap: 4 }, chipMini('Option 1'), chipMini('Option 2')) : T(v.State === 'Open' ? 'Op' : 'Search or select', { s: 14, c: v.State === 'Open' ? '$text' : '$textMuted', prop: 'Text' }), F({ w: 'fill' }), v.State === 'Closed' ? false : Ic('close', 12, '$textMuted'), Ic(v.State === 'Closed' ? 'down' : 'up', 12, '$textMuted')),
    v.State === 'Closed' ? false : listbox(['Option 1', 'Option 2', 'Option 3', 'Option 4'])));
  set(pg, 'Button Group', { Variant: ['Outlined', 'Contained', 'Text'], Orientation: ['Horizontal', 'Vertical'] }, v => { const h = v.Orientation === 'Horizontal', c = v.Variant === 'Contained';
    const items = ['One', 'Two', 'Three'].flatMap((t, i): Kid[] => [btnBox(t, { fill: c ? '$primary' : undefined, fg: c ? '$onPrimary' : '$primary', w: h ? undefined : 120 }), i < 2 && v.Variant !== 'Text' ? R({ w: h ? 1 : 'fill', h: h ? 36 : 1, fill: c ? '$onPrimary/40' : '$borderStrong' }) : false]);
    return F({ name: 'Button Group', dir: h ? 'row' : 'col', r: 'sm', clip: true, stroke: v.Variant === 'Outlined' ? '$borderStrong' : undefined, fill: c ? '$primary' : undefined }, ...items); });
  set(pg, 'Radio Group', { Direction: ['Vertical', 'Horizontal'] }, v => col({ name: 'Radio Group', gap: 8 }, T('Gender', { s: 13, w: 600, prop: 'Label' }), F({ dir: v.Direction === 'Vertical' ? 'col' : 'row', gap: v.Direction === 'Vertical' ? 8 : 24 }, ...['Female', 'Male', 'Other'].map((t, i) => row({ gap: 10 }, F({ w: 20, h: 20, main: 'center', cross: 'center', r: 10, stroke: i === 0 ? '$primary' : '$borderStrong', sw: 1.5 }, i === 0 ? circle(10, '$primary') : false), T(t, { s: 14 }))))));
  comp(pg, 'Transfer List', () => { const list = (title: string, items: string[], on: number[]) => col({ name: title, w: 180, r: 'md', stroke: '$border', fill: '$surface', clip: true }, row({ w: 'fill', h: 44, pad: [0, 12], gap: 10 }, checkBox(false, true, false), T(title, { s: 14, w: 600 })), Div(), ...items.map((t, i) => row({ w: 'fill', h: 36, pad: [0, 12], gap: 10 }, checkBox(on.includes(i), false, false), T(t, { s: 14 }))));
    const arrow = (g: string) => F({ w: 36, h: 28, main: 'center', cross: 'center', r: 4, stroke: '$borderStrong' }, Ic(g, 14));
    return row({ name: 'Transfer List', gap: 16 }, list('Choices', ['List item 1', 'List item 2', 'List item 3', 'List item 4'], [1]), col({ gap: 8 }, arrow('right'), arrow('left')), list('Chosen', ['List item 5', 'List item 6'], [])); });
  set(pg, 'Toggle Button', { Selected: ['Left', 'Center', 'Right', 'None'] }, v => row({ name: 'Toggle Button', r: 'sm', clip: true, stroke: '$borderStrong' }, ...['Left', 'Center', 'Right'].flatMap((t, i): Kid[] => [i ? R({ w: 1, h: 40, fill: '$borderStrong' }) : false, F({ w: 48, h: 40, main: 'center', cross: 'center', fill: v.Selected === t ? '$secondary' : undefined }, T('≡', { s: 18, c: v.Selected === t ? '$onSecondary' : '$textMuted', w: 700 }))])));
  set(pg, 'Icons', { Style: ['Outlined', 'Filled', 'Rounded'] }, v => col({ name: 'Icons', gap: 8 }, ...[['home', 'search', 'gear', 'user'], ['mail', 'bell', 'heart', 'star'], ['cal', 'menu', 'plus', 'close']].map(r => row({ gap: 8 }, ...r.map(g => iconTile(g === 'search' ? 'dot' : g, v.Style))))));
  set(pg, 'Material Icons', { Size: ['Small', 'Medium', 'Large'] }, v => { const d = { Small: 20, Medium: 24, Large: 36 }[v.Size]!; return row({ name: 'Material Icons', gap: 16 }, ...['home', 'gear', 'user', 'mail', 'bell', 'heart', 'star', 'cal'].map(g => Ic(g, d))); });
  set(pg, 'List', { Density: ['Default', 'Dense'], Style: ['Plain', 'Divided', 'Inset'] }, v => { const h = v.Density === 'Dense' ? 36 : 52;
    return col({ name: 'List', w: 320, r: 'md', fill: '$surface', stroke: '$border', clip: true }, ...['Inbox', 'Drafts', 'Sent', 'Trash'].flatMap((t, i): Kid[] => [row({ w: 'fill', h, pad: [0, 16, 0, v.Style === 'Inset' ? 56 : 16], gap: 16 }, v.Style === 'Inset' ? false : F({ w: 20, h: 20, r: 5, stroke: '$textMuted', sw: 1.6 }), T(t, { s: 14, w: i === 0 ? 600 : 400 }), F({ w: 'fill' }), i === 0 ? T('4', { s: 12, c: '$textMuted' }) : false), i < 3 && v.Style !== 'Plain' ? Div() : false])); });
  set(pg, 'Backdrop', { Tone: ['Dark', 'Light'] }, v => F({ name: 'Backdrop', w: 360, h: 220, main: 'center', cross: 'center', fill: v.Tone === 'Dark' ? '#000000/50' : '#FFFFFF/60', r: 'md' }, ringLayer(40, 0.28, 4, v.Tone === 'Dark' ? '#FFFFFF' : '$primary', '#FFFFFF/30')));
  set(pg, 'Paper', { Elevation: ['0', '1', '4', '8', '16', '24'] }, v => { const e = Number(v.Elevation); return F({ name: 'Paper', w: 160, h: 100, main: 'center', cross: 'center', r: 'sm', fill: '$surface', stroke: e === 0 ? '$border' : undefined, shadow: e === 0 ? undefined : e <= 1 ? 'sm' : e <= 8 ? 'md' : 'lg' }, T(`elevation ${e}`, { s: 13, c: '$textMuted' })); });
  set(pg, 'Menubar', { Open: ['None', 'File', 'Edit'] }, v => col({ name: 'Menubar', gap: 4 }, row({ pad: 4, gap: 2, r: 'md', stroke: '$border', fill: '$surface' }, ...['File', 'Edit', 'View', 'Help'].map(t => F({ h: 32, pad: [0, 12], main: 'center', cross: 'center', r: 6, fill: v.Open === t ? '$surfaceAlt' : undefined }, T(t, { s: 14, w: 500 })))),
    v.Open === 'None' ? false : col({ w: 200, pad: 6, r: 'md', fill: '$surface', stroke: '$border', shadow: 'lg' }, ...(v.Open === 'File' ? ['New', 'Open…', 'Save', 'Exit'] : ['Undo', 'Redo', 'Cut', 'Paste']).map((t, i) => row({ w: 'fill', h: 34, pad: [0, 10], r: 6, fill: i === 0 ? '$surfaceAlt' : undefined }, T(t, { s: 14 }), F({ w: 'fill' }), T(['⌘N', '⌘O', '⌘S', '⌘Q'][i], { s: 12, c: '$textMuted' }))))));
  set(pg, 'Speed Dial', { State: ['Closed', 'Open'] }, v => col({ name: 'Speed Dial', cross: 'end', gap: 12 }, ...(v.State === 'Open' ? ['Copy', 'Save', 'Print'].map(t => row({ gap: 10 }, F({ h: 26, pad: [0, 10], main: 'center', cross: 'center', r: 6, fill: '$inverse' }, T(t, { s: 12, c: '$onInverse' })), F({ w: 40, h: 40, main: 'center', cross: 'center', r: 20, fill: '$surface', shadow: 'md' }, Ic('star', 16)))) : []),
    F({ w: 56, h: 56, main: 'center', cross: 'center', r: 28, fill: '$primary', shadow: 'md' }, Ic(v.State === 'Open' ? 'close' : 'plus', 22, '$onPrimary'))));
  const dash = (label: string, w: number | 'fill', h: number | 'fill') => F({ name: label, w, h, main: 'center', cross: 'center', stroke: '$primary', dash: [5, 4], fill: '$primary/8', r: 4 }, T(label, { s: 12, c: '$primary', w: 600 }));
  set(pg, 'Box', { Padding: ['0', '1', '2', '3'] }, v => F({ name: 'Box', pad: Number(v.Padding) * 8, stroke: '$borderStrong', dash: [5, 4], r: 4 }, dash('Content', 160, 60)));
  set(pg, 'Container', { MaxWidth: ['xs 444', 'sm 600', 'md 900'] }, v => F({ name: 'Container', w: Number(v.MaxWidth.split(' ')[1]) / 2, pad: [16, 24], stroke: '$info', dash: [6, 4], r: 4 }, dash(`Container ${v.MaxWidth}`, 'fill', 80)));
  set(pg, 'Grid', { Columns: ['2', '3', '4', '12'] }, v => { const n = Number(v.Columns); return row({ name: 'Grid', w: 480, gap: n === 12 ? 4 : 16 }, ...Array.from({ length: n }, (_, i) => dash(n === 12 ? String(i + 1) : `xs=${12 / n}`, 'fill', 72))); });
  set(pg, 'Stack', { Direction: ['Row', 'Column'], Spacing: ['1', '2', '3'] }, v => F({ name: 'Stack', dir: v.Direction === 'Row' ? 'row' : 'col', gap: Number(v.Spacing) * 8 }, ...['Item 1', 'Item 2', 'Item 3'].map(t => F({ w: 84, h: 44, main: 'center', cross: 'center', r: 'sm', fill: '$secondary' }, T(t, { s: 13, w: 600, c: '$onSecondary' })))));
  set(pg, 'Image List', { Variant: ['Standard', 'Quilted', 'Titled'] }, v => { const t = (w: number, h: number, l?: string) => F({ w, h, fill: '$surfaceAlt', r: 4, main: 'end', cross: 'start', dir: 'col' }, l ? row({ w: 'fill', h: 28, pad: [0, 8], fill: '#000000/50', cross: 'center' }, T(l, { s: 12, c: '#FFFFFF' })) : false);
    return v.Variant === 'Quilted' ? row({ name: 'Image List', gap: 4, cross: 'start' }, col({ gap: 4 }, t(180, 120), t(180, 120)), t(120, 244), col({ gap: 4 }, t(120, 120), t(120, 120)))
      : col({ name: 'Image List', gap: 4 }, ...[0, 1].map(r => row({ gap: 4 }, ...[0, 1, 2].map(c => t(120, 120, v.Variant === 'Titled' ? `Image ${r * 3 + c + 1}` : undefined))))); });
  set(pg, 'Masonry', { Columns: ['2', '3'] }, v => row({ name: 'Masonry', gap: 8, cross: 'start' }, ...Array.from({ length: Number(v.Columns) }, (_, c) => col({ gap: 8 }, ...[[90, 130, 70], [120, 80, 110], [70, 100, 120]][c].map(h => F({ w: 110, h, r: 'sm', fill: ['$secondary', '$successSoft', '$warningSoft'][c] }))))));
  const util = (name: string, desc: string, g: string) => row({ name, w: 400, pad: 16, gap: 14, r: 'lg', stroke: '$border', fill: '$surface' }, F({ w: 44, h: 44, main: 'center', cross: 'center', r: 'md', fill: '$secondary' }, Ic(g, 20, '$onSecondary')), col({ w: 'fill', gap: 3 }, T(name.replace('util:', ''), { s: 15, w: 700 }), T(desc, { s: 12, c: '$textMuted', fw: 'fill' })));
  comp(pg, 'Click-Away Listener', () => col({ name: 'Click-Away Listener', gap: 10 }, util('Click-Away Listener', 'Calls onClickAway when a click lands outside its child.', 'dot'), row({ gap: 12 }, F({ w: 120, h: 56, main: 'center', cross: 'center', r: 'md', fill: '$secondary' }, T('Inside', { s: 13, w: 600, c: '$onSecondary' })), F({ w: 120, h: 56, main: 'center', cross: 'center', r: 'md', stroke: '$borderStrong', dash: [4, 4] }, T('Outside ✕', { s: 13, c: '$textMuted' })))));
  comp(pg, 'CSS Baseline', () => util('CSS Baseline', 'Resets browser defaults: margins, box-sizing, font smoothing, background.', 'gear'));
  comp(pg, 'InitColorSchemeScript', () => util('InitColorSchemeScript', 'Applies the saved light/dark mode before first paint to avoid a flash.', 'eye'));
  comp(pg, 'No SSR', () => util('No SSR', 'Renders its children only on the client, after hydration.', 'right'));
  comp(pg, 'Portal', () => col({ name: 'Portal', gap: 10 }, util('Portal', 'Renders children into a DOM node outside the parent hierarchy.', 'up'), row({ gap: 8 }, F({ w: 120, h: 44, main: 'center', cross: 'center', r: 'md', stroke: '$borderStrong', dash: [4, 4] }, T('#root', { s: 12, c: '$textMuted', mono: true })), Ic('right', 18, '$textMuted'), F({ w: 120, h: 44, main: 'center', cross: 'center', r: 'md', fill: '$secondary' }, T('document.body', { s: 12, c: '$onSecondary', mono: true })))));
  set(pg, 'Textarea Autosize', { Rows: ['1', '3', '5'] }, v => F({ name: 'Textarea Autosize', w: 300, h: 24 + Number(v.Rows) * 22, pad: 12, r: 'md', stroke: '$primary', sw: 2, fill: '$surface', dir: 'col' }, T('Type here and the box grows with the content…', { s: 14, fw: 'fill', c: '$textMuted' })));
  set(pg, 'Transitions', { Type: ['Fade', 'Grow', 'Slide', 'Zoom', 'Collapse'] }, v => col({ name: 'Transitions', w: 200, pad: 16, gap: 10, r: 'lg', stroke: '$border', fill: '$surface' }, T(v.Type, { s: 14, w: 700 }), row({ gap: 6 }, ...[0.25, 0.6, 1].map((o, i) => F({ w: v.Type === 'Slide' ? 24 + i * 12 : 34, h: v.Type === 'Collapse' ? 14 + i * 14 : 34, r: 'sm', fill: '$primary', op: v.Type === 'Fade' || v.Type === 'Grow' ? o : 1 }))), T('enter → exit', { s: 12, c: '$textMuted' })));
  set(pg, 'useMediaQuery', { Breakpoint: ['xs', 'sm', 'md', 'lg', 'xl'] }, v => { const w = { xs: '0', sm: '600', md: '900', lg: '1200', xl: '1536' }[v.Breakpoint]!; return row({ name: 'useMediaQuery', pad: [10, 16], gap: 10, r: 'lg', stroke: '$border', fill: '$surface' }, F({ h: 24, pad: [0, 10], main: 'center', cross: 'center', r: 12, fill: '$primary' }, T(v.Breakpoint, { s: 12, w: 700, c: '$onPrimary' })), T(`theme.breakpoints.up('${v.Breakpoint}')  ≥ ${w}px`, { s: 12, mono: true })); });
  comp(pg, 'util:Modal', () => F({ name: 'Modal', w: 420, h: 260, main: 'center', cross: 'center', fill: '#000000/50', r: 'md' }, col({ w: 300, pad: 20, gap: 8, r: 'lg', fill: '$surface', shadow: 'lg' }, T('Modal title', { s: 16, w: 700, prop: 'Title' }), T('Modal content rendered above a backdrop, trapping focus.', { s: 13, c: '$textMuted', fw: 'fill' }))));
  comp(pg, 'Popper', () => col({ name: 'Popper', cross: 'center', gap: 4 }, F({ w: 12, h: 12, r: 2, fill: '$inverse' }), col({ pad: [8, 12], r: 'md', fill: '$inverse' }, T('Popper content anchored to a reference element', { s: 12, c: '$onInverse', fw: 180 })), btnBox('Anchor', { fill: '$primary', fg: '$onPrimary' })));
  comp(pg, 'Data Grid', () => { const cols: [string, number][] = [['ID', 56], ['First name', 130], ['Last name', 130], ['Age', 70], ['Status', 100]];
    const data = [['1', 'Jon', 'Snow', '35', 'Active'], ['2', 'Cersei', 'Lannister', '42', 'Active'], ['3', 'Arya', 'Stark', '16', 'Pending'], ['4', 'Daenerys', 'Targaryen', '29', 'Active'], ['5', 'Ned', 'Stark', '50', 'Blocked']];
    return col({ name: 'Data Grid', w: 640, r: 'md', stroke: '$border', fill: '$surface', clip: true },
      row({ w: 'fill', h: 52, pad: [0, 16], gap: 12 }, T('Users', { s: 16, w: 700 }), F({ w: 'fill' }), T('COLUMNS', { s: 12, w: 700, c: '$primary' }), T('FILTERS', { s: 12, w: 700, c: '$primary' }), T('EXPORT', { s: 12, w: 700, c: '$primary' })), Div(),
      row({ w: 'fill', h: 48, pad: [0, 16], gap: 12, fill: '$surfaceAlt' }, checkBox(false, false, false), ...cols.map(c => row({ w: c[1], gap: 4 }, T(c[0], { s: 13, w: 700 }), c[0] === 'First name' ? Ic('up', 10, '$textMuted') : false))),
      ...data.flatMap((r, i): Kid[] => [Div(), row({ w: 'fill', h: 48, pad: [0, 16], gap: 12, fill: i === 1 ? '$secondary' : undefined }, checkBox(i === 1, false, false), ...r.map((c, j) => T(c, { s: 13, fw: cols[j][1], w: j === 4 ? 600 : 400, c: j === 4 ? (c === 'Active' ? '$success' : c === 'Pending' ? '$warning' : '$danger') : '$text' })))]),
      Div(), row({ w: 'fill', h: 52, pad: [0, 16], gap: 16, main: 'end' }, T('Rows per page: 5', { s: 12, c: '$textMuted' }), T('1–5 of 100', { s: 12, c: '$textMuted' }), Ic('left', 16, '$textMuted'), Ic('right', 16))); });
  set(pg, 'Date and Time Pickers', { Type: ['Date', 'Time'] }, v => v.Type === 'Date'
    ? col({ name: 'Date Picker', w: 300, pad: 16, gap: 10, r: 'lg', fill: '$surface', stroke: '$border', shadow: 'lg' }, T('Select date', { s: 12, c: '$textMuted', case: 'UPPER' }), T('Fri, Nov 14', { s: 28, w: 500 }), Div(), row({ w: 'fill', main: 'between' }, T('November 2026', { s: 14, w: 600 }), row({ gap: 12 }, Ic('left', 18), Ic('right', 18))), ...[['S', 'M', 'T', 'W', 'T', 'F', 'S'], ['1', '2', '3', '4', '5', '6', '7'], ['8', '9', '10', '11', '12', '13', '14']].map((r, ri) => row({ w: 'fill', main: 'between' }, ...r.map(d => F({ w: 32, h: 32, main: 'center', cross: 'center', r: 16, fill: d === '14' && ri === 2 ? '$primary' : undefined }, T(d, { s: 13, c: ri === 0 ? '$textMuted' : d === '14' && ri === 2 ? '$onPrimary' : '$text', w: ri === 0 ? 600 : 400 }))))), row({ w: 'fill', main: 'end', gap: 8 }, btnBox('Cancel'), btnBox('OK')))
    : col({ name: 'Time Picker', w: 280, pad: 20, gap: 16, r: 'lg', fill: '$surface', stroke: '$border', shadow: 'lg', cross: 'center' }, row({ gap: 8 }, F({ w: 80, h: 64, main: 'center', cross: 'center', r: 'md', fill: '$secondary' }, T('10', { s: 40, c: '$onSecondary' })), T(':', { s: 40 }), F({ w: 80, h: 64, main: 'center', cross: 'center', r: 'md', fill: '$surfaceAlt' }, T('30', { s: 40 }))),
      F({ w: 200, h: 200, main: 'center', cross: 'center', r: 100, fill: '$surfaceAlt' }, ...[]), row({ w: 'fill', main: 'end', gap: 8 }, btnBox('Cancel'), btnBox('OK'))));
  comp(pg, 'Tree View', () => { const item = (t: string, d: number, o: 'open' | 'closed' | 'leaf', sel = false) => row({ w: 'fill', h: 32, pad: [0, 8, 0, 8 + d * 20], gap: 6, r: 6, fill: sel ? '$secondary' : undefined }, o === 'leaf' ? F({ w: 12 }) : Ic(o === 'open' ? 'down' : 'right', 12, '$textMuted'), F({ w: 16, h: 14, r: 3, fill: o === 'leaf' ? '$borderStrong' : '$warning' }), T(t, { s: 13, w: sel ? 600 : 400 }));
    return col({ name: 'Tree View', w: 260, pad: 8, r: 'md', stroke: '$border', fill: '$surface' }, item('src', 0, 'open'), item('components', 1, 'open'), item('Button.tsx', 2, 'leaf', true), item('Card.tsx', 2, 'leaf'), item('hooks', 1, 'closed'), item('public', 0, 'closed'), item('package.json', 0, 'leaf')); });
  comp(pg, 'About the lab', () => col({ name: 'About the lab', w: 380, pad: 20, gap: 8, r: 'lg', fill: '$warningSoft', stroke: '$warning/40' }, row({ gap: 8 }, T('⚗', { s: 24 }), T('About the lab', { s: 18, w: 700, prop: 'Title' })), T('Experimental components that are still being polished before they move to the core library. Expect breaking changes.', { s: 13, fw: 'fill', c: '$textMuted' })));
  comp(pg, 'Timeline', () => { const it = (left: string, right: string, last = false) => row({ w: 'fill', gap: 12, cross: 'start' }, T(left, { s: 12, c: '$textMuted', fw: 70, al: 'RIGHT' }), col({ cross: 'center', gap: 4 }, F({ w: 14, h: 14, r: 7, fill: '$primary' }), last ? false : R({ w: 2, h: 36, fill: '$border' })), T(right, { s: 14, fw: 'fill', w: 500 }));
    return col({ name: 'Timeline', w: 340, gap: 4 }, it('9:30 am', 'Eat'), it('10:00 am', 'Code'), it('12:00 am', 'Sleep'), it('9:00 am', 'Repeat', true)); });

  // ================= regroup into the Material UI catalogue =================
  const RENAME: Record<string, string> = { 'Number Stepper': 'Number Field', Breadcrumb: 'Breadcrumbs', Toast: 'Snackbar', Modal: 'Dialog', 'util:Modal': 'Modal', 'Side Drawer': 'Drawer', 'Dropdown Menu': 'Menu', 'Material App Bar': 'App Bar', 'Progress Bar': 'Progress', Chart: 'Charts', Text: 'Typography' };
  const OLD: Record<string, string> = { Actions: 'Inputs', 'Inputs & Forms': 'Inputs', Selection: 'Inputs', Navigation: 'Navigation', 'Data Display': 'Data Display', Feedback: 'Feedback', Overlays: 'Surfaces', Platform: 'Platform', Typography: 'Data Display', Patterns: 'Patterns', MUI: 'Inputs' };
  const OVER: Record<string, string> = {
    Dialog: 'Feedback', 'Alert Dialog (iOS)': 'Feedback', 'Action Sheet (iOS)': 'Feedback', Banner: 'Feedback', 'Empty State': 'Feedback', 'Inline Message': 'Feedback', Backdrop: 'Feedback',
    'Bottom Sheet': 'Surfaces', 'Command Palette': 'Surfaces', 'App Bar': 'Surfaces', Accordion: 'Surfaces', Card: 'Surfaces', 'Stat Card': 'Surfaces', Paper: 'Surfaces',
    Drawer: 'Navigation', Menu: 'Navigation', 'Menu Item': 'Navigation', Menubar: 'Navigation', 'Speed Dial': 'Navigation', 'Top App Bar': 'Navigation', Navbar: 'Navigation', Sidebar: 'Navigation',
    Footer: 'Layout', Box: 'Layout', Container: 'Layout', Grid: 'Layout', Stack: 'Layout', 'Image List': 'Layout',
    Popover: 'Utils', Modal: 'Utils', Popper: 'Utils', Portal: 'Utils', 'Click-Away Listener': 'Utils', 'CSS Baseline': 'Utils', InitColorSchemeScript: 'Utils', 'No SSR': 'Utils', 'Textarea Autosize': 'Utils', Transitions: 'Utils', useMediaQuery: 'Utils',
    'Data Grid': 'MUI X', 'Date and Time Pickers': 'MUI X', Charts: 'MUI X', 'Tree View': 'MUI X',
    'About the lab': 'Lab', Masonry: 'Lab', Timeline: 'Lab',
    Skeleton: 'Feedback', Link: 'Navigation', Chip: 'Data Display', Icons: 'Data Display', 'Material Icons': 'Data Display', List: 'Data Display', 'Code Block': 'Data Display',
  };
  const doc = K.doc, root = doc.nodes[doc.rootId];
  const found: { id: string; name: string; cat: string }[] = [];
  for (const pid of root.children) for (const cid of doc.nodes[pid].children) {
    const n = doc.nodes[cid]; n.name = RENAME[n.name] ?? n.name;
    found.push({ id: cid, name: n.name, cat: OVER[n.name] ?? OLD[origin.get(cid) ?? ''] ?? 'Patterns' });
  }
  for (const pid of root.children) delete doc.nodes[pid];
  root.children = [];
  for (const cat of ['Inputs', 'Data Display', 'Feedback', 'Surfaces', 'Navigation', 'Layout', 'Utils', 'MUI X', 'Lab', 'Platform', 'Patterns']) {
    const mine = found.filter(f => f.cat === cat).sort((a, b) => a.name.localeCompare(b.name));
    if (!mine.length) continue;
    const p = page(cat);
    for (const f of mine) { doc.nodes[f.id].parent = p.id; doc.nodes[p.id].children.push(f.id); place(p, f.id); }
  }

  // pages are laid out; remember the library's purpose
  K.doc.nodes[K.doc.rootId].name = 'Design System';
  return K.doc;
}
void defaultNode;
