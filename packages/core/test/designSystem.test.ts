import { describe, expect, it } from 'vitest';
import { DocStore, buildDefaultDesignSystem, createEmptyDocument, importedCount, insertLibraryComponent, listLibraryComponents, pageIds, setInstanceVariant, syncLibraryComponents, validateDocument, LIBRARY_PAGE } from '../src';

describe('default design system', () => {
  const lib = buildDefaultDesignSystem();
  const items = listLibraryComponents(lib);

  it('is a valid document with many components in categories', () => {
    expect(() => validateDocument(lib)).not.toThrow();
    expect(items.length).toBeGreaterThan(70);
    const cats = new Set(items.map(i => i.category));
    for (const c of ['Inputs', 'Data Display', 'Feedback', 'Surfaces', 'Navigation', 'Layout', 'Utils', 'MUI X', 'Lab', 'Platform', 'Patterns']) expect(cats.has(c)).toBe(true);
    const MUI: Record<string, string[]> = {
      Inputs: ['Autocomplete', 'Button', 'Button Group', 'Checkbox', 'Floating Action Button', 'Number Field', 'Radio Group', 'Rating', 'Select', 'Slider', 'Switch', 'Text Field', 'Transfer List', 'Toggle Button'],
      'Data Display': ['Avatar', 'Badge', 'Chip', 'Divider', 'Icons', 'Material Icons', 'List', 'Table', 'Tooltip', 'Typography'],
      Feedback: ['Alert', 'Backdrop', 'Dialog', 'Progress', 'Skeleton', 'Snackbar'],
      Surfaces: ['Accordion', 'App Bar', 'Card', 'Paper'],
      Navigation: ['Bottom Navigation', 'Breadcrumbs', 'Drawer', 'Link', 'Menu', 'Menubar', 'Pagination', 'Speed Dial', 'Stepper', 'Tabs'],
      Layout: ['Box', 'Container', 'Grid', 'Stack', 'Image List'],
      Utils: ['Click-Away Listener', 'CSS Baseline', 'InitColorSchemeScript', 'Modal', 'No SSR', 'Popover', 'Popper', 'Portal', 'Textarea Autosize', 'Transitions', 'useMediaQuery'],
      'MUI X': ['Data Grid', 'Date and Time Pickers', 'Charts', 'Tree View'],
      Lab: ['About the lab', 'Masonry', 'Timeline'],
    };
    for (const [cat, names] of Object.entries(MUI)) for (const n of names) expect(items.some(i => i.name === n && i.category === cat), `${cat}/${n}`).toBe(true);
  });
  it('lays out every component with finite, positive sizes', () => {
    for (const it of items) { const n = lib.nodes[it.id]; expect(n.width, it.name).toBeGreaterThan(0); expect(n.height, it.name).toBeGreaterThan(0); }
    const btn = lib.nodes[items.find(i => i.name === 'Button')!.id];
    expect(btn.children.length).toBe(30);
    expect(lib.nodes[btn.children[0]].width).toBeGreaterThan(40);
  });
  it('imports into a design file, reuses the copy, switches variants and syncs', () => {
    const store = new DocStore(createEmptyDocument());
    const page = pageIds(store.doc)[0];
    const btn = items.find(i => i.name === 'Button')!;
    const a = insertLibraryComponent(store, lib, 'LIB', btn.id, { parent: page, x: 10, y: 20 })!;
    const b = insertLibraryComponent(store, lib, 'LIB', btn.id, { parent: page, x: 10, y: 80 })!;
    expect(store.doc.nodes[a].type).toBe('INSTANCE');
    expect(importedCount(store.doc, 'LIB')).toBe(1); // second use reuses the copy
    expect(store.doc.nodes[a].componentId).toBe(store.doc.nodes[b].componentId);
    expect(pageIds(store.doc).some(p => store.doc.nodes[p].name === LIBRARY_PAGE)).toBe(true);
    expect(Object.keys(store.doc.variables).length).toBeGreaterThan(10);
    expect(() => validateDocument(store.doc)).not.toThrow();
    expect(setInstanceVariant(store, a, { Type: 'Danger' })).toBe(true);
    // edit the design system: a new label colour on the primary button → sync
    const libBtn = lib.nodes[btn.id];
    const first = lib.nodes[libBtn.children[0]];
    first.opacity = 0.5;
    expect(syncLibraryComponents(store, lib, 'LIB')).toBe(1);
    const localSet = store.doc.nodes[store.doc.nodes[store.doc.nodes[b].componentId!].parent!];
    expect(store.doc.nodes[localSet.children[0]].opacity).toBe(0.5);
    expect(() => validateDocument(store.doc)).not.toThrow();
    store.undo(); store.undo();
  });
  it('imports every component without error', () => {
    const store = new DocStore(createEmptyDocument());
    const page = pageIds(store.doc)[0];
    for (const it of items) expect(insertLibraryComponent(store, lib, 'LIB', it.id, { parent: page }), it.name).toBeTruthy();
    expect(() => validateDocument(store.doc)).not.toThrow();
  });
});

describe('addMissingComponents', () => {
  it('tops up an older design system without touching what is there', async () => {
    const { addMissingComponents } = await import('../src');
    const defaults = buildDefaultDesignSystem();
    const store = new DocStore(buildDefaultDesignSystem());
    const names = listLibraryComponents(store.doc).map(i => i.name);
    const gone = store.doc.nodes[listLibraryComponents(store.doc).find(i => i.name === 'Paper')!.id];
    store.apply({ t: 'remove', id: gone.id });
    expect(addMissingComponents(store, defaults)).toBe(1);
    expect(listLibraryComponents(store.doc).map(i => i.name).sort()).toEqual([...names].sort());
    expect(addMissingComponents(store, defaults)).toBe(0);
    expect(() => validateDocument(store.doc)).not.toThrow();
  });
});
