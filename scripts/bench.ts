import { cpus, totalmem } from 'node:os';
import { DocStore, addNode, createEmptyDocument, defaultNode, hitChain, pageIds, validateDocument, setProps, DEFAULT_LAYOUT } from '../packages/core/src';

/** Core-model benchmark (no rendering). Targets are declared BEFORE measuring; see TESTING.md. */
const TARGETS = { createMs: 2000, validateMs: 300, serializeMs: 400, parseMs: 400, hitTestMs: 2, dragStepMs: 8, layoutRelayoutMs: 16 };
const N = Number(process.argv[2] ?? 10000);

const t = (f: () => void) => { const s = performance.now(); f(); return performance.now() - s; };
const store = new DocStore(createEmptyDocument());
const page = pageIds(store.doc)[0];
const out: Record<string, number> = {};

out.createMs = t(() => {
  const cols = 100;
  store.transact('bulk', () => {
    for (let f = 0; f < N / 100; f++) {
      const frame = defaultNode('FRAME', { x: (f % 10) * 500, y: Math.floor(f / 10) * 500, width: 480, height: 480 });
      addNode(store, frame, page);
      for (let i = 0; i < 99; i++) addNode(store, defaultNode('RECT', { x: (i % 10) * 45, y: Math.floor(i / 10) * 45, width: 40, height: 40 }), frame.id);
    }
  });
  void cols;
});
out.validateMs = t(() => validateDocument(store.doc));
let json = '';
out.serializeMs = t(() => { json = JSON.stringify(store.doc); });
out.parseMs = t(() => { JSON.parse(json); });
const samples = 200;
out.hitTestMs = t(() => { for (let i = 0; i < samples; i++) hitChain(store.doc, page, { x: (i * 37) % 5000, y: (i * 91) % 5000 }); }) / samples;
const first = store.doc.nodes[page].children[0], kid = store.doc.nodes[first].children[0];
out.dragStepMs = t(() => { store.begin('drag'); for (let i = 0; i < samples; i++) store.apply({ t: 'set', id: kid, props: { x: i } }); store.commit(); }) / samples;
// auto layout: 200 children in one hugging frame, resize one child
const al = defaultNode('FRAME', { layout: { ...DEFAULT_LAYOUT, mode: 'HORIZONTAL' }, sizingH: 'HUG', sizingV: 'HUG' });
addNode(store, al, page);
for (let i = 0; i < 200; i++) addNode(store, defaultNode('RECT', { width: 20, height: 20 }), al.id);
const k0 = store.doc.nodes[al.id].children[0];
out.layoutRelayoutMs = t(() => { for (let i = 0; i < 50; i++) setProps(store, [k0], { width: 20 + i }); }) / 50;

console.log(JSON.stringify({ hardware: { cpu: cpus()[0].model, cores: cpus().length, ramGB: Math.round(totalmem() / 2 ** 30), node: process.version }, objects: Object.keys(store.doc.nodes).length, jsonMB: +(json.length / 1e6).toFixed(2), heapMB: Math.round(process.memoryUsage().heapUsed / 1e6), targets: TARGETS, measured: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, +v.toFixed(3)])) }, null, 2));
