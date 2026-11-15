/** Persistent document model (schema v1). Pure data, DOM-free, JSON-serialisable. */
export const SCHEMA_VERSION = 2; // v2 adds styles, variables and variable collections
export const ROOT_ID = 'doc';

export type NodeType = 'DOCUMENT' | 'PAGE' | 'FRAME' | 'GROUP' | 'RECT' | 'ELLIPSE' | 'LINE' | 'TEXT' | 'COMPONENT' | 'COMPONENT_SET' | 'INSTANCE' | 'VECTOR' | 'EMBED';
export type BlendMode = 'NORMAL' | 'DARKEN' | 'MULTIPLY' | 'PLUS_DARKER' | 'COLOR_BURN' | 'LIGHTEN' | 'SCREEN' | 'PLUS_LIGHTER' | 'COLOR_DODGE' | 'OVERLAY' | 'SOFT_LIGHT' | 'HARD_LIGHT' | 'DIFFERENCE' | 'EXCLUSION' | 'HUE' | 'SATURATION' | 'COLOR' | 'LUMINOSITY';
/** Blend modes in menu order, grouped the way design tools group them. */
export const BLEND_GROUPS: BlendMode[][] = [['NORMAL'], ['DARKEN', 'MULTIPLY', 'PLUS_DARKER', 'COLOR_BURN'], ['LIGHTEN', 'SCREEN', 'PLUS_LIGHTER', 'COLOR_DODGE'], ['OVERLAY', 'SOFT_LIGHT', 'HARD_LIGHT'], ['DIFFERENCE', 'EXCLUSION'], ['HUE', 'SATURATION', 'COLOR', 'LUMINOSITY']];
export const BLEND_LABEL: Record<BlendMode, string> = { NORMAL: 'Normal', DARKEN: 'Darken', MULTIPLY: 'Multiply', PLUS_DARKER: 'Plus darker', COLOR_BURN: 'Color burn', LIGHTEN: 'Lighten', SCREEN: 'Screen', PLUS_LIGHTER: 'Plus lighter', COLOR_DODGE: 'Color dodge', OVERLAY: 'Overlay', SOFT_LIGHT: 'Soft light', HARD_LIGHT: 'Hard light', DIFFERENCE: 'Difference', EXCLUSION: 'Exclusion', HUE: 'Hue', SATURATION: 'Saturation', COLOR: 'Color', LUMINOSITY: 'Luminosity' };
export const BLEND_MODES: BlendMode[] = BLEND_GROUPS.flat();

export interface SolidPaint { type: 'SOLID'; color: string; opacity: number; visible: boolean; /** how this fill blends with what is under it (default Normal) */ blendMode?: BlendMode }
export interface GradientStop { pos: number; color: string; opacity: number }
export interface LinearPaint { type: 'LINEAR'; stops: GradientStop[]; angle: number; opacity: number; visible: boolean; blendMode?: BlendMode }
/** Non-destructive image adjustments, each -100..100 (0 = unchanged). */
export interface ImageAdjust { exposure: number; contrast: number; saturation: number; temperature: number; tint: number; highlights: number; shadows: number }
export const IMAGE_ADJUST_KEYS: (keyof ImageAdjust)[] = ['exposure', 'contrast', 'saturation', 'temperature', 'tint', 'highlights', 'shadows'];
export interface ImagePaint { type: 'IMAGE'; assetId: string; scaleMode: 'FILL' | 'FIT' | 'STRETCH' | 'TILE'; /** quarter turns in degrees */ rotation?: 0 | 90 | 180 | 270; adjust?: Partial<ImageAdjust>; opacity: number; visible: boolean; blendMode?: BlendMode }
export type PatternAlign = 'tl' | 'tc' | 'tr' | 'ml' | 'c' | 'mr' | 'bl' | 'bc' | 'br';
/** A layer repeated as a tile. `scale` is a multiplier, spacing is a percentage of the (scaled) tile size. */
export interface PatternPaint { type: 'PATTERN'; sourceId: string | null; tile: 'RECT' | 'OFFSET'; scale: number; spacingX: number; spacingY: number; align: PatternAlign; opacity: number; visible: boolean; blendMode?: BlendMode }
export type Paint = SolidPaint | LinearPaint | ImagePaint | PatternPaint;

export interface DropShadow { type: 'DROP_SHADOW'; x: number; y: number; blur: number; color: string; opacity: number; visible: boolean }
export interface LayerBlur { type: 'LAYER_BLUR'; radius: number; visible: boolean }
export type Effect = DropShadow | LayerBlur;

export interface ExportSetting { format: 'PNG' | 'JPG' | 'WEBP'; scale: number; suffix: string }

export type TextCase = 'NONE' | 'UPPER' | 'LOWER' | 'TITLE' | 'SMALL_CAPS' | 'SMALL_CAPS_FORCED';
export interface TextProps {
  characters: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  lineHeight: number | 'AUTO'; // px or auto (1.2em)
  letterSpacing: number; // px
  align: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  /** fixed: w+h are user-set; auto-height: w fixed, h follows text; auto-width: both follow text */
  resize: 'FIXED' | 'AUTO_HEIGHT' | 'AUTO_WIDTH';
  /** vertical placement of the text inside a taller box (default top) */
  vAlign?: 'TOP' | 'MIDDLE' | 'BOTTOM';
  decoration?: 'NONE' | 'UNDERLINE' | 'STRIKE';
  textCase?: TextCase;
  listStyle?: 'NONE' | 'BULLET' | 'NUMBER';
  paragraphSpacing?: number;
  paragraphIndent?: number;
  /** cut text that does not fit a fixed-height box and end it with an ellipsis */
  truncate?: boolean;
  /** `NONE` keeps every paragraph on one line */
  wrap?: 'AUTO' | 'NONE';
  /** trim the first line's leading space down to the cap height */
  trim?: 'STANDARD' | 'CAP_HEIGHT';
  /** italic angle in degrees, -12…0 (0 = upright) */
  slant?: number;
  /** OpenType feature flags by tag (kern, tnum, ss01, cv01 …); only kerning, case and small caps are drawn on the canvas */
  features?: Record<string, boolean>;
}

export type BrushId = 'CHARCOAL' | 'MARKER' | 'CHALK' | 'INK';
export type WidthProfile = 'UNIFORM' | 'TAPER' | 'BULGE' | 'TAPER_BOTH';
export type EndPoint = 'NONE' | 'ROUND' | 'SQUARE' | 'ARROW' | 'TRIANGLE' | 'REVERSED_TRIANGLE' | 'CIRCLE' | 'DIAMOND';
export type BoolOp = 'UNION' | 'SUBTRACT' | 'INTERSECT' | 'EXCLUDE';
export interface PropDef { name: string; type: 'TEXT' | 'BOOLEAN' | 'INSTANCE_SWAP'; default: string | boolean }
/** An anchor with bezier handles; ix/iy and ox/oy are handle offsets relative to the anchor. */
export interface PathPoint { x: number; y: number; ix: number; iy: number; ox: number; oy: number }
/** Path in the node's local space (origin = node x,y). Segment i joins points[i] → points[i+1] (and last → first when closed). */
export interface VectorPath { points: PathPoint[]; closed: boolean }
export interface LayoutGuide { type: 'GRID' | 'COLUMNS' | 'ROWS'; /** grid cell size, or column/row count */ size: number; gutter: number; margin: number; color: string; opacity: number; visible: boolean }
// ---- prototyping ----
export type Easing = 'LINEAR' | 'EASE_IN' | 'EASE_OUT' | 'EASE_IN_OUT' | 'EASE_IN_BACK' | 'EASE_OUT_BACK' | 'EASE_IN_OUT_BACK' | 'SPRING' | { bezier: [number, number, number, number] };
export type Direction = 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM';
export interface Animation { type: 'INSTANT' | 'DISSOLVE' | 'SMART_ANIMATE' | 'MOVE_IN' | 'MOVE_OUT' | 'PUSH' | 'SLIDE_IN' | 'SLIDE_OUT'; direction?: Direction; easing: Easing; duration: number }
export type OverlayPosition = 'CENTER' | 'TOP_LEFT' | 'TOP_CENTER' | 'TOP_RIGHT' | 'BOTTOM_LEFT' | 'BOTTOM_CENTER' | 'BOTTOM_RIGHT' | 'BELOW_TRIGGER';
export interface OverlayOpts { position: OverlayPosition; closeOnOutside: boolean; backdrop: boolean }
export type ProtoAction =
  | { type: 'NAVIGATE'; to: string; anim: Animation }
  | ({ type: 'OVERLAY_OPEN'; to: string; anim: Animation } & OverlayOpts)
  | ({ type: 'OVERLAY_SWAP'; to: string; anim: Animation } & OverlayOpts)
  | { type: 'OVERLAY_CLOSE'; to?: string; anim: Animation }
  | { type: 'BACK'; anim: Animation }
  | { type: 'SCROLL_TO'; to: string; anim: Animation }
  | { type: 'LINK'; url: string }
  | { type: 'CHANGE_TO'; to: string; anim: Animation }
  | { type: 'SET_VAR'; variableId: string; expr: string }
  | { type: 'CONDITIONAL'; branches: { cond: string; actions: ProtoAction[] }[]; otherwise: ProtoAction[] };
export interface Trigger { type: 'CLICK' | 'HOVER' | 'PRESS' | 'MOUSE_ENTER' | 'MOUSE_LEAVE' | 'MOUSE_DOWN' | 'MOUSE_UP' | 'DRAG' | 'KEY' | 'DELAY'; key?: string; delay?: number }
export interface Interaction { id: string; trigger: Trigger; actions: ProtoAction[] }
/** `device`: 'NONE' or a device id from devices.ts (legacy 'PHONE' / 'DESKTOP' still load) */
export interface ProtoSettings { device: string; background: string }
export type Sizing = 'FIXED' | 'HUG' | 'FILL';
/**
 * Auto layout (frames, components, instances). Children are laid out in order (bottom→top child order = first→last).
 * Rotated children use their unrotated width/height. Wrapping and grid layout are not implemented.
 */
export interface AutoLayout {
  mode: 'HORIZONTAL' | 'VERTICAL';
  gap: number;
  padT: number; padR: number; padB: number; padL: number;
  /** alignment along the layout direction */
  primaryAlign: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  /** alignment across the layout direction */
  counterAlign: 'MIN' | 'CENTER' | 'MAX';
}

/**
 * Geometry rules:
 *  - x,y: position of the node's top-left corner in its PARENT's coordinate space.
 *  - rotation: degrees, clockwise, applied about the node's own top-left (x,y). The editor
 *    compensates so interactive rotation appears to pivot about the visual centre.
 *  - children are stored bottom -> top (last child paints on top).
 *  - LINE: width is its length, height is 0; only strokes render.
 */
/** A live card on the canvas that shows another file (a whiteboard). Double-click opens it. */
export interface EmbedRef { fileId: string; fileName: string; kind: 'whiteboard' }

export interface SceneNode {
  id: string;
  type: NodeType;
  /** only on EMBED nodes */
  embed?: EmbedRef;
  name: string;
  parent: string | null;
  children: string[];
  x: number; y: number; width: number; height: number; rotation: number;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: BlendMode;
  fills: Paint[];
  strokes: Paint[];
  strokeWeight: number;
  strokeAlign: 'INSIDE' | 'CENTER' | 'OUTSIDE';
  cornerRadius: number;
  clipsContent: boolean;
  effects: Effect[];
  exportSettings: ExportSetting[];
  text?: TextProps;
  layout?: AutoLayout;
  path?: VectorPath;
  /** extra contours of a compound vector (flattened shapes); filled with the even-odd rule together with `path` */
  subpaths?: VectorPath[];
  /** this layer clips the layers above it in the same parent (Figma-style mask) */
  isMask?: boolean;
  /** GROUP only: render the children as one shape combined with this boolean operation */
  boolOp?: BoolOp;
  /** text-on-path: the curve the characters follow, in this node's local space (scaled with the node's size) */
  textPath?: VectorPath;
  strokeCap?: 'NONE' | 'ROUND' | 'SQUARE';
  strokeJoin?: 'MITER' | 'ROUND' | 'BEVEL';
  /** which stroke tab is active: plain, dynamic (wiggle) or brush (variable width, rough edges) */
  strokeKind?: 'BASIC' | 'DYNAMIC' | 'BRUSH';
  strokeDynamic?: { frequency: number; wiggle: number; smoothen: number };
  strokeBrush?: { id: BrushId; direction: 'LEFT' | 'RIGHT' };
  /** how the width varies along the stroke (Basic and Brush); `strokeProfileFlip` reverses it */
  strokeProfile?: WidthProfile;
  strokeProfileFlip?: boolean;
  /** miter join angle in degrees (default 28.96°, i.e. a miter limit of about 4) */
  strokeMiterAngle?: number;
  /** end points of an open path or line: flat, round or square ends, or a line / triangle / reversed triangle / circle / diamond arrow */
  strokeStart?: EndPoint;
  strokeEnd?: EndPoint;
  /** dash pattern in px (alternating dash/gap); empty or missing = solid */
  dashes?: number[];
  /** independent corner radii [top-left, top-right, bottom-right, bottom-left]; overrides cornerRadius when set */
  cornerRadii?: [number, number, number, number];
  /** editor-only layout guides (not exported) */
  guides?: LayoutGuide[];
  /** prototype interactions (trigger → actions) */
  interactions?: Interaction[];
  /** top-level frame that starts a prototype flow (value = flow name) */
  flowStart?: string;
  /** frame scrolls its content in the prototype player */
  overflowScroll?: 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'BOTH';
  /** PAGE: canvas background colour (default follows the theme: Figma-style grey / dark) */
  canvasBg?: string;
  /** PAGE: how the player presents the prototype */
  proto?: ProtoSettings;
  /** sizing of this node: inside an auto-layout parent (FILL/HUG/FIXED) or, for auto-layout frames, hugging content */
  sizingH?: Sizing;
  sizingV?: Sizing;
  /** child of an auto-layout frame that opts out of the flow */
  absolute?: boolean;
  /** COMPONENT inside a COMPONENT_SET: its value for each variant property */
  variant?: Record<string, string>;
  /** COMPONENT / COMPONENT_SET: component property definitions (text, boolean, instance swap) */
  props?: PropDef[];
  /** layer inside a component: which component property drives which of its attributes */
  bind?: { characters?: string; visible?: string; componentId?: string };
  /** shared styles this node follows (their value overwrites the node's matching properties) */
  styleRefs?: StyleRefs;
  /** property path → variable id (paths: fills.N.color, strokes.N.color, opacity, cornerRadius, strokeWeight, width, height, visible, layout.gap, layout.padT|R|B|L, text.characters, text.fontSize) */
  varBindings?: Record<string, string>;
  /** explicit variable mode for this node's subtree, per collection (theme switching) */
  modeOverrides?: Record<string, string>;
  /** INSTANCE root: chosen values of component properties (falls back to defaults) */
  propValues?: Record<string, string | boolean>;
  /** INSTANCE root: the main component it mirrors */
  componentId?: string;
  /** node inside an instance: id of the node in the main component it mirrors */
  sourceId?: string;
  /** property names overridden locally (kept when the main component changes) */
  overrides?: string[];
  /** imported from a linked design system: `<design system file id>:<node id in that file>` */
  libRef?: string;
}

export type VarType = 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
export type VarValue = string | number | boolean | { alias: string };
/** Which properties a variable may be bound to (picker filter, mirrors Figma's variable scopes). */
export type VarScope = 'ALL' | 'FILL' | 'STROKE' | 'OPACITY' | 'RADIUS' | 'SPACING' | 'SIZE' | 'FONT_SIZE' | 'TEXT_CONTENT' | 'VISIBILITY';
export interface Variable { id: string; collectionId: string; name: string; type: VarType; values: Record<string, VarValue>; scopes: VarScope[] }
/** The first mode is the collection's default. */
export interface VarCollection { id: string; name: string; modes: { id: string; name: string }[] }
export type StyleType = 'FILL' | 'TEXT' | 'EFFECT' | 'LAYOUT';
export interface Style { id: string; type: StyleType; name: string; value: any }
export interface StyleRefs { fill?: string; stroke?: string; text?: string; effect?: string; layout?: string }

export interface AssetRef { name: string; mime: string; width?: number; height?: number }

export interface DocumentData {
  schemaVersion: number;
  rootId: string;
  nodes: Record<string, SceneNode>;
  assets: Record<string, AssetRef>;
  styles: Record<string, Style>;
  variables: Record<string, Variable>;
  collections: Record<string, VarCollection>;
}

export const solid = (color: string, opacity = 1): SolidPaint => ({ type: 'SOLID', color, opacity, visible: true });

let counter = 0;
export function newId(prefix = 'n'): string {
  const r = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 12) : (Math.random().toString(36).slice(2, 14) + (counter++));
  return `${prefix}_${r}`;
}

export function defaultNode(type: NodeType, patch: Partial<SceneNode> = {}): SceneNode {
  const base: SceneNode = {
    id: newId(), type, name: type[0] + type.slice(1).toLowerCase(), parent: null, children: [],
    x: 0, y: 0, width: 100, height: 100, rotation: 0, visible: true, locked: false, opacity: 1,
    blendMode: 'NORMAL', fills: [], strokes: [], strokeWeight: 1, strokeAlign: 'INSIDE', cornerRadius: 0,
    clipsContent: false, effects: [], exportSettings: [],
  };
  if (type === 'FRAME' || type === 'COMPONENT' || type === 'COMPONENT_SET' || type === 'INSTANCE') { base.fills = [solid('#FFFFFF')]; base.clipsContent = true; base.width = 400; base.height = 300; }
  if (type === 'EMBED') { base.fills = [solid('#FFFFFF')]; base.width = 640; base.height = 440; base.cornerRadius = 16; base.name = 'Whiteboard'; base.clipsContent = true; }
  if (type === 'RECT') base.fills = [solid('#D9D9D9')];
  if (type === 'ELLIPSE') base.fills = [solid('#D9D9D9')];
  if (type === 'LINE') { base.height = 0; base.strokes = [solid('#000000')]; base.strokeWeight = 2; base.strokeAlign = 'CENTER'; }
  if (type === 'TEXT') {
    base.fills = [solid('#000000')]; base.height = 24; base.width = 120;
    base.text = { characters: 'Text', fontFamily: 'Inter, Helvetica, Arial, sans-serif', fontSize: 16, fontWeight: 400, italic: false, lineHeight: 'AUTO', letterSpacing: 0, align: 'LEFT', resize: 'AUTO_WIDTH' };
  }
  return { ...base, ...patch };
}

export function createEmptyDocument(): DocumentData {
  const pageId = newId('page');
  return {
    schemaVersion: SCHEMA_VERSION, rootId: ROOT_ID, assets: {}, styles: {}, variables: {}, collections: {},
    nodes: {
      [ROOT_ID]: defaultNode('DOCUMENT', { id: ROOT_ID, name: 'Document', children: [pageId] }),
      [pageId]: defaultNode('PAGE', { id: pageId, name: 'Page 1', parent: ROOT_ID }),
    },
  };
}

export function pageIds(doc: DocumentData): string[] { return doc.nodes[doc.rootId].children; }

export const isFrameLike = (n: SceneNode) => n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'COMPONENT_SET';
export function isContainer(n: SceneNode): boolean { return n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'COMPONENT_SET' || n.type === 'INSTANCE' || n.type === 'GROUP' || n.type === 'PAGE' || n.type === 'DOCUMENT'; }
