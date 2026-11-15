# Feature matrix

Reference date: **2026-11-01**. "Verified" availability below comes only from official pages surfaced by web search on that date
(snippets, not full page reads — re-read the source before relying on a row). Everything else is marked **assumption**.
Implementation status: `missing` · `partial` · `working` (exercised by an automated test) · `verified` (also checked manually in a browser).

Sources consulted: [Release notes](https://www.figma.com/release-notes/) · [Config 2026 recap](https://www.figma.com/blog/config-2026-recap/) ·
[What's new from Config India 2026](https://help.figma.com/hc/en-us/articles/43663368947863-What-s-new-from-Config-India-2026) ·
[Config 2026 admin guide](https://help.figma.com/hc/en-us/articles/41301052048791-Config-2026-a-guide-for-admins) ·
[REST API changelog](https://developers.figma.com/docs/rest-api/changelog/) · [MCP tools](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/) ·
[Add a backend to a prototype](https://help.figma.com/hc/en-us/articles/32640822050199-Add-a-backend-to-a-functional-prototype-or-web-app).

## A. Confirmed third-party product facts (what we are matching)

| Product / feature | Availability (per source, 2026-11-01) | Source |
|---|---|---|
| Code layers (interactive code-backed canvas content, duplicate/compare) | Open beta, all plans; creating/editing free through 2026-11-04 on paid plans | Config 2026 recap, Config India guide |
| Custom shaders / fills (WebGPU, save/reuse, export via MCP) | Open beta, paid plans; first-party agent-built shaders open beta for Full seats | Config 2026 recap |
| Figma Motion (timeline + agent animation) | Open beta | Config 2026 recap |
| Weave tools in Design (AI image tasks); Weave models via MCP (2026-10-26); internal publishing of Weave tools on Org/Enterprise (2026-10-30) | Released / rolling (per release notes) | Release notes |
| Agent (chats visible to collaborators, custom skills, web search, MCP connectors) | Open beta, paid plans | Config 2026 recap |
| Generative plugins (describe a tool, agent builds a reusable plugin); version history for plugin/shader edits (2026-10-27) | Released/open beta (wording varies) | Config 2026 recap, release notes |
| 3D transforms; agent in FigJam and Slides | Announced — "coming soon" | Config 2026 recap |
| Specs, Guidelines for libraries, centralized design-system preview | Announced at Config India 2026; exact tier **unverified** | Config India help article |
| Payload backend scaffolding in Make (CMS, DB, media, auth, admin) | Available now on listed plans; hosted in eastern US | Release notes 2026-10-15, backend help article |
| REST API: folders endpoints (2026-08-10), colour-opacity variable type (2026-09-17) | Released | REST API changelog |
| Design, Draw, FigJam, Slides, Sites, Buzz, Dev Mode | **Assumption**: generally available product surfaces; per-feature availability not individually verified | — |

## B. Our product (Layr) — implementation status

| Area / feature | Expected workflow | Dependencies | Acceptance | Status |
|---|---|---|---|---|
| Auth, profile, personal workspace | Register/sign in, session cookie | scrypt, sessions table | `api.test` auth tests, replayed token rejected after logout | working |
| Teams / multi-user workspaces | Invite people into a workspace | — | — | missing |
| Projects | Create/rename/delete, move files in | projects table | `api.test` "search, sort, favorites, drafts and projects" | working |
| Files: create/rename/duplicate/trash/restore/delete forever | Dashboard menus | files table | `api.test` | working |
| Recent, drafts, favorites, shared, search, sort | Sidebar + search box | | `api.test` | working |
| Thumbnails | Rendered by the engine after save, uploaded as PNG | engine export | manual | partial (verified in dashboard) |
| Sharing owner/editor/viewer; revoke | Share dialog (existing users by email) | file_members | `api.test` matrix + `permissions.spec` (UI + server 403/404) | working |
| Share links, email invitations | — | mail provider | — | missing |
| Autosave + conflict detection (revision CAS) | Debounced PUT; 409 → banner with "save as copy" | | `api.test`, `permissions.spec` conflict | working |
| Local crash recovery | localStorage backup, restored if based on same revision | | `milestone1.spec` offline test | working |
| Version history / named versions | — | snapshots table | — | missing |
| Templates | Two built-in starter docs | | manual | partial |
| Shared libraries, notifications, workspace settings, org admin, audit | — | | — | missing |
| Whiteboard file type (FigJam-style board) | Own document format (`kind: 'jam'`), validated on every write, revision-checked saves, duplicate/trash/share like design files | `packages/core/src/jam.ts`, `apps/web/src/jam/` | `api.test`, `core.test`, `whiteboard.spec` | partial — see below |
| Whiteboard card inside a design file (`EMBED` layer) | Layer that references a whiteboard file by id; when selected the real whiteboard is live inside it (autosaved), resizable like any layer; dragging items off the board (or Send selection to design) copies them in as editable frames, text, shapes and vector paths (photos stay images); other cards draw the board read-only in whiteboard style; the live toolbar scales with the design zoom; validated on every write; exports as a rounded rectangle in `.fig`, skipped in `.xd` | `packages/core/src/{model,validate}.ts`, `apps/web/src/engine/render.ts`, `editor/{Dock,session,controller,Inspector,EmbedEditor,embedExport}` | `core.test` (embed layer), `embed-whiteboard.spec` | partial — one live card at a time, see limitations |
| Prototype action: open a whiteboard | `WHITEBOARD` action (any trigger, including hover): the player shows the board read-only with pan/zoom, an open-for-editing link and a way back; the interaction panel lists your whiteboards | `packages/core/src/{model,prototype}.ts`, `apps/web/src/proto/{Player,WhiteboardView}.tsx`, `editor/PrototypePanel.tsx` | `core.test` (prototype runtime), `proto-whiteboard.spec` | partial — read-only, see limitations |
| Other file types (slides, sites, brand, generated apps) | API refuses with an explicit error | | `api.test` | missing |
| Editor shell: left rail, pages, layers, assets; right inspector; dock; command search; context menu; themes; resizable panels | | | e2e + manual | working |
| Canvas: flat Figma-style grey/dark background (no dot grid), per-page background colour (click empty canvas → page panel; reset), rounded handles, gradient size pill, zoom pill | Page panel | | `canvas-bg.spec` | working |
| Tooltips/shortcuts | `title` attributes + registry | | manual | working |
| Infinite pan/zoom, fit, zoom-to-selection, coordinate conversion | wheel, ⌘-wheel, ⇧1/⇧2/⇧0 | | `core.test` geometry, `milestone1.spec` viewport | working |
| Selection: click, marquee, shift, deep select, hover, hit-test | | | `core.test`, e2e | working |
| Move/resize/rotate/duplicate (⌥-drag)/group/ungroup/lock/hide/reorder | | | `core.test`, e2e | working |
| Alignment, distribution, snapping + smart guides | | | `core.test` (align/distribute); snapping manual | partial |
| Rulers, grids, measurement overlays | — | | — | missing |
| Nested transforms, frame clipping, z-order | | | `core.test` | working |
| Masks | — | | — | missing |
| Undo/redo (transactional, local) | | | `core.test` history | working |
| Frames, groups, rect, ellipse, line, text, images | | | `core.test`, e2e | working |
| Section (a frame preset), star, polygon (triangle), arrow (single path with a retraced head), brush | Dock: frame / shape / draw menus | controller.ts | manual | partial (no true section node, no arrowhead property, star/polygon have fixed point counts) |
| Mask, boolean operations (union / subtract / intersect / exclude), edit object | Dock after Comments; edit bar above the dock | engine/render.ts, `shapeOps.ts`, controller vec tools | `core.test`, `mask-boolean-edit.spec` | partial (booleans are live groups: no flatten, the group's own fill is ignored; masks clip the layers above in the same parent; edit bar tools: move, lasso, paint, bend, cut, erase) |
| Paste from Figma (⌘V of layers copied in Figma: frames, groups, rectangles, ellipses, lines, vectors, stars, polygons, booleans, text with fonts, fills, gradients, strokes, shadows, blur) | Paste anywhere in the editor | `apps/web/src/figma/` | `figma.test` (synthetic clipboard), `figma-paste.spec` | partial (see limitations; checked only against a synthetic clipboard built from Figma's schema, not a real Figma copy) |
| Import .fig (zip or bare fig-kiwi: all pages, images, layers) and .xd (artboards, shapes, text, gradients, images) from Home → Import; export .fig (all pages) and .xd (current page) from the main menu | Home pills, main menu | `apps/web/src/interchange/` | `interchange.test` (round trips through our own reader and writer), `import-export.spec` | experimental: never opened in Figma or Adobe XD themselves (see limitations) |
| Text on path (click a vector; text follows a copy of its curve) | Dock text menu | engine/render.ts, `textPath` on TEXT nodes | `core.test` (validation), manual | partial (the path is a copy, not linked to the vector; characters past the end are hidden; no offset or flip) |
| Colour picker popover: Custom (saturation/brightness square, hue, alpha, eyedropper where the browser supports it, HEX/RGB/HSL input, opacity, “On this page” and preset swatches, solid ↔ linear gradient with stops and angle) and Libraries (search, per-collection filter, colour variables and fill styles; picking binds a variable on fills/strokes; + saves the colour as a variable) | Click any swatch | | `colorpicker.spec` | working |
| Fills (solid, linear, image), strokes (inside/centre/outside), opacity, blend modes, drop shadow, layer blur | | | manual | partial (radial/angular gradients missing; group opacity is per-child) |
| Typography section (family, weight, size presets, line height, tracking, horizontal + vertical align) and type settings panel: Basics (justify, underline / strike, case, small caps, vertical trim, bullet / numbered lists, paragraph spacing, truncate with ellipsis, wrap), Details (paragraph indent, OpenType flags), Variable (weight slider, slant) | Typography section → sliders button | engine/text.ts, `editor/Typography.tsx` | `typography.spec` | partial (OpenType flags are saved and shown in the preview but the canvas draws only kerning, case and small caps) |
| Text editing, size/weight/line-height/tracking/align/resize modes | | system fonts only | e2e (typing) | partial (no font upload/Google Fonts, single style per node) |
| Image place/replace/fit/fill; crop | place, drop, paste, replace | asset upload | e2e | partial (no crop) |
| Pen (P) and pencil (⇧P): click/drag anchors with bezier handles, open/closed paths, close on first anchor, Enter/Esc/double-click to finish; pencil simplifies + smooths freehand | Dock Pen group | path.ts | `core.test` (vector paths, 8 cases), `vector.spec` | working |
| Path editing: select/move anchors and handles, add anchor on outline, delete, smooth↔corner (double-click), open/close, node re-fit | Double-click or ↵ on a vector | | `core.test`, `vector.spec` | working |
| Stroke settings panel (style, dash / gap, cap, start / end points, join, miter angle) | Stroke section → sliders button | engine/render.ts `drawEndPoints` | `vector.spec` | | `vector.spec` (inspector), renderer manual | partial (inside/outside alignment is not applied to vectors) |
| On-canvas corner-radius handles (circles inside each corner; drag = all corners, Alt = one corner, clamped to half the short side) | Select a rectangle/frame | | `radius-handles.spec` | working |
| Independent corner radius; layout guides (grid, columns, rows; editor-only) | Appearance, Layout guide | | `vector.spec`; guide drawing manual | working |
| Boolean operations, SVG import/export, vector networks, arrowheads | — | | — | missing |
| Auto layout H/V: padding, gap, align, space-between, hug/fill/fixed, absolute children, nesting | Inspector Layout section, ⇧A | layout.ts | `core.test` (6 cases incl. nested hug/fill), `layout-components.spec` | working |
| Auto layout wrap, grid, min/max, constraints | — | | — | missing |
| Components: create, instance, propagation, overrides, reset, detach, go-to-main | ⌥⌘K, Assets tab | components.ts | `core.test` (5 cases), `layout-components.spec` | working |
| Variants / component sets: combine, add variant, variant properties (add/rename/remove), per-variant values, instance variant switching with override carry-over | ⌘⇧K, Variants section, instance dropdowns | components.ts | `core.test` (4 cases), `variants.spec` | working |
| Component properties: text, boolean, instance swap; bind layers; per-instance values + reset | Properties section; layer binding selects | | `core.test`, `variants.spec` | working |
| Nested-instance overrides beyond swap, variant-aware bindings (auto-copy across variants), library publishing | — | | — | missing |
| Shared styles: fill/stroke colour, text, effect, auto-layout; create from layer, apply, detach, edit propagates, rename/delete | ⁝⁝ button in inspector sections; Assets tab | tokens.ts | `core.test` (styles), `variables-styles.spec` | working |
| Full-page Variables view (left-rail icon): collections with counts, groups from `/` names, modes as columns, inline value/alias editing with the colour picker, scopes, search, create variable by type; bind while designing from the inspector or the picker's Libraries tab | Rail → Variables | | `variables-page.spec` | working |
| Variables: collections, modes, COLOR/FLOAT/STRING/BOOLEAN, aliases (cross-collection, cycle/type checked), scopes, bindings (fill/stroke colour, opacity, radius, stroke weight, gap/padding, font size, text, visibility), per-frame mode switching, instances resolve in their own mode | Variables dialog, ◇ buttons, Appearance → modes | schema v2 | `core.test` (9 cases), `variables-styles.spec` | working |
| Theme switching | Frame → variable mode select | | `variables-styles.spec` (child recolours, undo/redo) | working |
| Token import/export (Layr JSON) | Variables dialog | | `core.test` round trip | working |
| W3C design-tokens JSON import (type inheritance, `{alias}` refs, px units) and export per collection | Variables page | tokens.ts | `core.test`, `variables-page.spec` | working |
| Figma-native token interop, library publishing/review/adoption, variable bindings for width/height/radius per corner, expressions, gradient-stop variables | — | | — | missing |
| Prototype mode: drag-to-connect, connection arrows, flow starting points (badges, list), interaction editor | Prototype tab / dock mode | prototype.ts | `prototype.spec` | working |
| Triggers: click, drag, while hovering, while pressing, mouse enter/leave/down/up, key press, after delay | Interactions section | | `core.test` runtime, `prototype.spec` (hover, delay, key) | working |
| Actions: navigate, back, open/swap/close overlay (position, backdrop, close on outside), scroll to, open link (http/https/mailto only), change to (component variant), set variable, conditional (if / else-if / else) | | | `core.test` (8 runtime cases), `prototype.spec` | working |
| Animations: instant, dissolve, smart animate (layer matching by name+type), move in/out, push, slide in/out; easing presets, custom bezier, spring; duration | | blend.ts, ease() | `core.test` (blend, easing), `prototype.spec` (pixels) | working |
| Variables + expressions in prototypes (arithmetic, strings, booleans, comparisons, logic; `{name}` refs) and bound layers updating live | | tokens | `core.test` | working |
| Player: present on a private copy, restart, back, flow picker, scale to fit/100%, device frames (none/phone/desktop), hotspot overlay, scrolling frames (wheel/drag), standalone `#/play/<id>` link | ▶ button, ⌥⌘↵ | | `prototype.spec` | working |
| Public (unauthenticated) share links, comment-in-prototype, video/gamepad/voice triggers, scroll-linked animation, fixed-position layers while scrolling, sticky layers | — | | — | missing |
| Multiplayer (CRDT), presence, comments, follow | Comments/rail disabled | WebSocket server | — | missing |
| Dev Mode, specs, MCP surface, code export | Dev toggle disabled | | — | missing |
| FigJam-style whiteboard: sticky notes, shapes (17), connectors (straight/elbow/curve, caps, labels, magnets, quick "+" copies, Tab), text, sections, pen/marker/highlighter/eraser, stamps, tables, code blocks, images, link cards, timer, voting, comments with replies/resolve, templates (6), group/lock/align/distribute/grid, snapping, rotate/resize, copy/paste/duplicate, PNG + board-file export, undo/redo | Built | `apps/web/src/jam/*` | `e2e/whiteboard.spec.ts` | partial |
| Whiteboard: live cursors, multiplayer editing, cursor chat, emotes, audio, spotlight/follow, AI actions, widgets/plugins, Mermaid/diagram generation, SVG/PDF export | — | | — | missing |
| Slides, Sites, Buzz | — | | — | missing |
| Make / code layers / Motion / shaders / plugins / Weave / agent | No UI that pretends; credentials absent | provider adapters | — | missing |
| Export PNG/JPG/WEBP (1–4x, per-layer saved settings), native `.layr` export/import | | | `milestone1.spec` (PNG header + size, native round trip) | working |
| SVG/PDF export, `.fig` import | — | | — | missing |
| Schema versioning + validation on every write | | | `core.test` | working |

## Fill types (colour picker)
| Feature | Status | Notes |
|---|---|---|
| Solid, linear gradient | Built | — |
| **Pattern fill**: repeat any layer as a tile (grid or offset rows), scale, spacing X/Y, 3×3 alignment, live preview, pick the source by clicking a layer | Built | Renders on the canvas and in PNG/JPG/WebP exports; not exported to `.fig` / `.xd` (becomes a grey solid). Deleting the source layer leaves a grey placeholder. |
| **Image fill**: upload, fit mode (fill / fit / stretch / tile), 90° rotation, non-destructive exposure, contrast, saturation, temperature, tint, highlights and shadows | Built | Adjustments are simple per-pixel maths on a copy capped at 1600 px, not a colour-managed pipeline. No crop mode. |
| "Make an image" (AI generation) | Not available | Button is shown disabled; no AI provider is configured. |
| Radial / angular / diamond gradients, video fills, noise | Not built | Icons removed (video) or disabled (noise). |

## Blend modes
| Feature | Status | Notes |
|---|---|---|
| 18 layer blend modes in grouped menu (Normal; Darken, Multiply, Plus darker, Color burn; Lighten, Screen, Plus lighter, Color dodge; Overlay, Soft light, Hard light; Difference, Exclusion; Hue, Saturation, Color, Luminosity) with the current mode highlighted | Built | Opened from the droplet in Appearance. Rendered with canvas compositing, so it also applies in exports. |
| **Plus darker** | Approximate | Canvas has no equivalent; it renders like Multiply. Exported to `.fig` as Linear burn. |
| Per-fill blend modes, "Pass through" for groups | Not built | Blend is per layer only. |
