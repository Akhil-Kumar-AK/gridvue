# Roadmap

| Phase | Scope | State |
|---|---|---|
| 1 | Workspace, persistence, canvas, shapes, text, images, layers, inspector, undo/redo, autosave, native + image export | **done** (see FEATURE_MATRIX) |
| 2 | Auto layout ✅ · components/instances ✅ · variants + component properties ✅ · styles ✅ · variables/modes ✅ · constraints · vector editing ✅ (booleans/SVG pending) · libraries | partial — next: constraints, then vector paths, then library publishing |
| 3 | WebSocket sync (op-based LWW), presence/cursors, comments, live permission changes, version history | next after Phase 2 |
| 4 | Prototyping ✅ · Dev Mode, structured specs (CSS from real properties), MCP-compatible read surface | partial — next: Dev Mode |
| 5 | Whiteboard, Slides, Sites, Buzz | planned |
| 6 | Server-side AI adapters (real provider only; honest "not configured" state), code layers (sandboxed iframe), Motion, shaders, plugins, node workflows | planned |
| Infra | PostgreSQL adapter, object storage, workers (thumbnails/exports), SVG sanitiser + import, `.fig` interop only if a verified path exists | planned |

Next slice: **multiplayer sync (op-based, WebSocket) with presence and live permission changes** — the Phase 3 foundation; constraints and vector editing follow.
