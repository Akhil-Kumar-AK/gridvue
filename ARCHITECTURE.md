# Architecture

```
packages/core    document model · geometry · commands · history · auto layout · components · validation   (pure TS, no DOM)
apps/server      node:http API · SQLite persistence · auth · permissions · assets                          (TypeScript, tsx)
apps/web         React shell · Canvas2D renderer · editor controller · inspector · dashboard               (Vite)
e2e/             Playwright (real Chrome) · scripts/bench.ts
```

## Decisions and trade-offs

**Rendering — Canvas 2D now, WebGL/WebGPU later.** Canvas 2D gives correct text, clipping, blend modes, shadows and gradients with almost no code,
and the renderer only depends on a `CanvasRenderingContext2D`, so the same code draws the screen, exports and thumbnails. It is CPU-rasterised, so very large
documents will need tiling or a WebGL backend (blur, shaders, GPU effects are the reason for the eventual move). Viewport culling is implemented.
Editor chrome is DOM; design objects are never DOM nodes.

**Document model — flat node map + ordered children** (`nodes[id]`, `children[]` bottom→top). Transforms are `x, y, rotation` about the node's top-left in the
parent's space (no skew/scale), which keeps nested transforms and reparenting exact (`reparent` preserves world transforms; tested).

**Mutations — ops.** `set | insert | remove | move | asset` ops with computed inverses. A transaction is one undo step; consecutive sets coalesce; rollback
is supported for cancelled gestures. Derived state (auto layout, instance sync, group re-fit) is produced *inside* the store as additional recorded ops, so
undo/redo restores both the user's edit and its consequences atomically.

**Collaboration — not implemented; the plan.** Ops over an authenticated WebSocket with per-property last-writer-wins (fractional-index child order) is
the likely first model: it fits the flat property bag, and node/property granularity matches how designers conflict. A general text/sequence CRDT (Yjs)
would be needed only for rich text. Local undo already inverts only this client's ops, which is the property multiplayer needs. Today the server provides
optimistic concurrency (`baseRevision` compare-and-swap, 409 on conflict) — two tabs can never silently overwrite each other.

**Persistence — SQLite (`node:sqlite`, zero extra dependencies) behind a single `db.ts`.** The brief suggests PostgreSQL; the schema/migrations are plain SQL and
the data access is confined to `app.ts`, so a Postgres adapter is a bounded follow-up (ROADMAP). Documents are stored as validated JSON with a revision
counter; assets are BLOBs scoped to a file. Object storage and background workers are not implemented (thumbnails are generated client-side).

**Auto layout rules** (see `layout.ts`): children flow in order, skipping hidden and absolute children; HUG sizes a frame to padding + content; FILL children share
the remaining primary-axis space equally (counter-axis FILL stretches); nested HUG children are laid out bottom-up, FILL children top-down; rotated children use unrotated sizes.

**Component rules** (see `components.ts`): an instance mirrors its main component node-by-node (`sourceId`). Properties are copied unless listed in that node's
`overrides`; user edits to an instance node record an override automatically (in the store); structure is synced (layers added/removed/reordered in main appear in
instances); nested instances own their own children. Detach strips the link. Edits to instance structure (deleting a layer) are re-created on next sync — a known limitation.

**Styles and variables (schema v2).** `doc.styles`, `doc.variables`, `doc.collections` are edited with `meta` ops (undoable like everything else). Nodes carry
`styleRefs`, `varBindings` (property path → variable) and `modeOverrides` (collection → mode for a subtree). `syncBindings` recomputes bound/styled properties inside the store
after any relevant op (values edited, a node moved into another mode context, mode changed), *before* auto layout and instance sync run — so a bound gap re-flows layout and a
dark-mode frame recolours everything inside, in the same undo step. Instances resolve variables in their own ancestor context (not the main component's); a local override beats a binding.
Old documents are migrated v1→v2 on read (server) and on load (client backup).

**Prototyping.** Interactions are data on nodes (`interactions`, `flowStart`, `overflowScroll`). `PrototypeRuntime` (core, DOM-free, unit-tested) runs on a private clone of the
document and decides what each event does — navigation history, overlays, scroll offsets, variable changes (through the same binding engine, so bound text/colours update), instance variant
changes — and returns `Transition` descriptors. The web `Player` only animates those descriptors (dissolve, move/push/slide, smart animate via `blendFrames`, eased by `ease()`) with the shared Canvas 2D renderer.
Hover and press triggers revert (a BACK) when the pointer leaves the original layer's area, so a hover target that moves under the pointer cannot oscillate.

## Security
Session cookies are HttpOnly + SameSite=Lax with a same-origin check on mutations; passwords use scrypt; every route checks role server-side (404 hides
existence from non-members); uploads are magic-byte sniffed (PNG/JPEG/GIF/WebP only — **SVG is refused** until the sanitising importer exists); assets are served
with `nosniff` and a sandbox CSP; documents are structurally validated (and schema-versioned) before being stored; list search escapes LIKE wildcards; login attempts are rate-limited per IP+email.

## State classification
Persistent: document (`DocumentData`), assets, file metadata. Local UI only: selection, camera, tool, panel sizes, theme. Presence (future): cursors, selections.
