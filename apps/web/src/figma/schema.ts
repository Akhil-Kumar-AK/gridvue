import { ByteBuffer, compileSchema, encodeBinarySchema, parseSchema } from 'kiwi-schema';

/**
 * The part of Figma's kiwi schema we read and write (same type and field names as Figma's). Field ids only matter inside one file because the
 * schema travels with the data, so they are numbered in order.
 */
type Spec = [type: string, name: string][];
const enums: Record<string, string[]> = {
  NodeType: ['NONE', 'DOCUMENT', 'CANVAS', 'GROUP', 'FRAME', 'BOOLEAN_OPERATION', 'VECTOR', 'STAR', 'LINE', 'ELLIPSE', 'RECTANGLE', 'REGULAR_POLYGON', 'ROUNDED_RECTANGLE', 'TEXT', 'SLICE', 'SYMBOL', 'INSTANCE', 'SECTION'],
  PaintType: ['SOLID', 'GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR', 'GRADIENT_DIAMOND', 'IMAGE', 'EMOJI'],
  ImageScaleMode: ['STRETCH', 'FIT', 'FILL', 'TILE'],
  BlendMode: ['PASS_THROUGH', 'NORMAL', 'DARKEN', 'MULTIPLY', 'LINEAR_BURN', 'COLOR_BURN', 'LIGHTEN', 'SCREEN', 'LINEAR_DODGE', 'COLOR_DODGE', 'OVERLAY', 'SOFT_LIGHT', 'HARD_LIGHT', 'DIFFERENCE', 'EXCLUSION', 'HUE', 'SATURATION', 'COLOR', 'LUMINOSITY'],
  StrokeAlign: ['CENTER', 'INSIDE', 'OUTSIDE'],
  StrokeCap: ['NONE', 'ROUND', 'SQUARE', 'LINE_ARROW', 'TRIANGLE_ARROW', 'DIAMOND_FILLED', 'CIRCLE_FILLED'],
  StrokeJoin: ['MITER', 'BEVEL', 'ROUND'],
  EffectType: ['INNER_SHADOW', 'DROP_SHADOW', 'FOREGROUND_BLUR', 'BACKGROUND_BLUR'],
  NumberUnits: ['RAW', 'PIXELS', 'PERCENT'],
  TextAlignHorizontal: ['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED'],
  TextAlignVertical: ['TOP', 'CENTER', 'BOTTOM'],
  TextAutoResize: ['NONE', 'WIDTH_AND_HEIGHT', 'HEIGHT'],
  TextDecoration: ['NONE', 'UNDERLINE', 'STRIKETHROUGH'],
  TextCase: ['ORIGINAL', 'UPPER', 'LOWER', 'TITLE', 'SMALL_CAPS', 'SMALL_CAPS_FORCED'],
  BooleanOperation: ['UNION', 'INTERSECT', 'SUBTRACT', 'XOR'],
  WindingRule: ['NONZERO', 'ODD'],
  StackMode: ['NONE', 'HORIZONTAL', 'VERTICAL'],
  MessageType: ['JOIN_START', 'NODE_CHANGES'],
  Phase: ['CREATED', 'REMOVED'],
};
const structs: Record<string, Spec> = {
  GUID: [['uint', 'sessionID'], ['uint', 'localID']],
  Vector: [['float', 'x'], ['float', 'y']],
  Matrix: [['float', 'm00'], ['float', 'm01'], ['float', 'm02'], ['float', 'm10'], ['float', 'm11'], ['float', 'm12']],
  Color: [['float', 'r'], ['float', 'g'], ['float', 'b'], ['float', 'a']],
};
const messages: Record<string, Spec> = {
  ColorStop: [['Color', 'color'], ['float', 'position']],
  Image: [['byte[]', 'hash'], ['string', 'name']],
  Paint: [['PaintType', 'type'], ['Color', 'color'], ['float', 'opacity'], ['bool', 'visible'], ['BlendMode', 'blendMode'], ['ColorStop[]', 'stops'], ['Matrix', 'transform'], ['Image', 'image'], ['ImageScaleMode', 'imageScaleMode']],
  ParentIndex: [['GUID', 'guid'], ['string', 'position']],
  FontName: [['string', 'family'], ['string', 'style'], ['string', 'postscript']],
  Number: [['float', 'value'], ['NumberUnits', 'units']],
  TextData: [['string', 'characters']],
  Path: [['WindingRule', 'windingRule'], ['uint', 'commandsBlob']],
  Effect: [['EffectType', 'type'], ['Color', 'color'], ['Vector', 'offset'], ['float', 'radius'], ['bool', 'visible'], ['float', 'spread']],
  SymbolData: [['GUID', 'symbolID']],
  NodeChange: [
    ['GUID', 'guid'], ['Phase', 'phase'], ['ParentIndex', 'parentIndex'], ['NodeType', 'type'], ['string', 'name'], ['bool', 'visible'], ['bool', 'locked'], ['float', 'opacity'], ['BlendMode', 'blendMode'],
    ['Vector', 'size'], ['Matrix', 'transform'], ['float', 'strokeWeight'], ['StrokeAlign', 'strokeAlign'], ['StrokeCap', 'strokeCap'], ['StrokeJoin', 'strokeJoin'], ['float[]', 'strokeDashes'],
    ['Paint[]', 'fillPaints'], ['Paint[]', 'strokePaints'], ['Effect[]', 'effects'], ['float', 'cornerRadius'],
    ['float', 'rectangleTopLeftCornerRadius'], ['float', 'rectangleTopRightCornerRadius'], ['float', 'rectangleBottomLeftCornerRadius'], ['float', 'rectangleBottomRightCornerRadius'],
    ['bool', 'frameMaskDisabled'], ['Path[]', 'fillGeometry'], ['Path[]', 'strokeGeometry'], ['BooleanOperation', 'booleanOperation'], ['StackMode', 'stackMode'], ['SymbolData', 'symbolData'],
    ['TextData', 'textData'], ['float', 'fontSize'], ['FontName', 'fontName'], ['Number', 'lineHeight'], ['Number', 'letterSpacing'], ['TextAlignHorizontal', 'textAlignHorizontal'],
    ['TextAlignVertical', 'textAlignVertical'], ['TextAutoResize', 'textAutoResize'], ['TextDecoration', 'textDecoration'], ['TextCase', 'textCase'], ['float', 'paragraphSpacing'],
  ],
  Blob: [['byte[]', 'bytes']],
  Message: [['MessageType', 'type'], ['uint', 'sessionID'], ['NodeChange[]', 'nodeChanges'], ['Blob[]', 'blobs']],
};
export const FIGMA_SCHEMA_TEXT = [
  ...Object.entries(enums).map(([n, v]) => `enum ${n} { ${v.map((x, i) => `${x} = ${i};`).join(' ')} }`),
  ...Object.entries(structs).map(([n, f]) => `struct ${n} { ${f.map(([t, name]) => `${t} ${name};`).join(' ')} }`),
  ...Object.entries(messages).map(([n, f]) => `message ${n} { ${f.map(([t, name], i) => `${t} ${name} = ${i + 1};`).join(' ')} }`),
].join('\n');

let compiled: { schema: ReturnType<typeof parseSchema>; codec: any } | null = null;
export function figmaCodec() {
  if (!compiled) { const schema = parseSchema(FIGMA_SCHEMA_TEXT); compiled = { schema, codec: compileSchema(schema) }; }
  return { binarySchema: encodeBinarySchema(compiled.schema), encodeMessage: (m: unknown): Uint8Array => compiled!.codec.encodeMessage(m) };
}
void ByteBuffer;
