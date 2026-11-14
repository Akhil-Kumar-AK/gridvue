# Testing

```bash
npm test                  # unit + integration (vitest): 78 tests
npx playwright test       # browser tests in real Chrome (starts its own API + Vite on :8788/:5274, isolated DB)
npm run typecheck         # tsc
npm run bench             # core benchmark (no rendering)
```

| Layer | What is covered |
|---|---|
| `packages/core/test` | matrix/camera maths, nested transforms, hit-testing (z-order, ellipse, clip, lock), undo/redo state equality across op kinds, drag coalescing, rollback, atomic failure, group/ungroup/reparent world-stability, reorder, align/distribute, serialization, validation, auto layout (flow, hug, fill, space-between, nested, absolute, relayout on edit/undo), components (instances, propagation, overrides, reset, detach, auto-layout propagation), variants (combine, add/rename/duplicate-guard, switching with override carry-over, undo), component properties (text/boolean/instance-swap, defaults vs per-instance values, set-level default change), variables (binding + mode switching + undo, reparent into dark frame, numeric/boolean/text bindings reacting through layout, type/scope enforcement, aliases + cycles, deletion cleanup, mode copy, instances resolving in their own mode, dangling-reference validation, v1→v2 migration, token round trip), styles (fill/text/effect/layout, propagation, detach, delete, undo), prototype runtime (navigation + back with reversed animation, bubbling, overlays + backdrop + close-outside, variables/conditionals/expressions, change-to variants, scroll-to + scrolled hit-testing, link allow-list, delay/key triggers, missing destinations), expression evaluator safety, easing curves, smart-animate blending, vector paths (creation, hit-testing, bezier bounds, insert/delete/smooth, rotation-safe re-fit, resize scaling, pencil pipeline, validation) |
| `apps/server/test` | auth/session/logout replay, CSRF origin check, persistence round-trip, revision conflict 409, invalid document 422, asset sniffing/limits/ACL, duplicate with assets, trash/restore, native import, owner/editor/viewer/stranger matrix, role change + revocation, search/sort/favorites/projects, unimplemented file types |
| `e2e` | draw with real mouse input, type text, upload image, select + edit via inspector (with expressions), undo/redo, drag-move undo, reorder, layers DnD nesting, reload equality, PNG export byte-checked, native export→import, zoom anchoring, offline save recovery, viewer read-only (UI + server), stale-tab conflict banner, auto layout through the UI, component create/instance/override/detach, variants + properties through the UI (combine, add variant, property definition, instance value edit, variant switch), variables/modes/binding/theme switch/tokens/styles through the UI, pen/pencil/path editing, corner radii, layout guides, stroke options, prototype connect/present/navigate/back/standalone link, overlays + hotspots, hover/delay/key/conditional in the player |

## Benchmark (core model only)
Targets set before measuring (ms): create 10k objects ≤ 2000 · validate ≤ 300 · serialize ≤ 400 · parse ≤ 400 · hit-test ≤ 2 · drag step ≤ 8 · re-layout 200 children ≤ 16.

Measured 2026-11-01, Apple M3 Pro (12 cores, 18 GB), Node 24.22, 10,203 objects, 4.36 MB JSON, heap 37 MB:
create 79.7 · validate 5.4 · serialize 7.5 · parse 9.4 · hit-test 0.037 · drag step 0.004 · re-layout 0.51 — all targets met.

**Not measured yet** (so no numbers are claimed): canvas frame rate and interaction latency in the browser with a large document, browser memory, and network save/load times. A browser benchmark page is the next testing task.
