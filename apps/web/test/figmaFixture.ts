import { compileSchema, encodeBinarySchema, parseSchema } from 'kiwi-schema';
import { deflateSync } from 'fflate';

/** A schema with the subset of Figma's kiwi schema that we read (same names and structure as Figma's). */
const SCHEMA = `
enum NodeType { DOCUMENT = 1; CANVAS = 2; FRAME = 4; VECTOR = 5; ELLIPSE = 9; RECTANGLE = 10; TEXT = 13; }
enum PaintType { SOLID = 0; GRADIENT_LINEAR = 1; IMAGE = 5; }
enum NumberUnits { RAW = 0; PIXELS = 1; PERCENT = 2; }
struct GUID { uint sessionID; uint localID; }
struct Vector { float x; float y; }
struct Matrix { float m00; float m01; float m02; float m10; float m11; float m12; }
struct Color { float r; float g; float b; float a; }
message ColorStop { Color color = 1; float position = 2; }
message Paint { PaintType type = 1; Color color = 2; float opacity = 3; bool visible = 4; ColorStop[] stops = 5; Matrix transform = 6; }
message ParentIndex { GUID guid = 1; string position = 2; }
message FontName { string family = 1; string style = 2; }
message Number { float value = 1; NumberUnits units = 2; }
message TextData { string characters = 1; }
message Path { uint commandsBlob = 1; }
message Effect { string type = 1; Color color = 2; Vector offset = 3; float radius = 4; bool visible = 5; }
message NodeChange {
  GUID guid = 1; ParentIndex parentIndex = 2; NodeType type = 3; string name = 4; bool visible = 5; float opacity = 6; Vector size = 7; Matrix transform = 8;
  float strokeWeight = 9; Paint[] fillPaints = 10; Paint[] strokePaints = 11; float cornerRadius = 12; TextData textData = 13; float fontSize = 14; FontName fontName = 15;
  Number lineHeight = 16; Number letterSpacing = 17; Path[] fillGeometry = 18; Effect[] effects = 19;
}
message Blob { byte[] bytes = 1; }
message Message { NodeChange[] nodeChanges = 1; Blob[] blobs = 2; }
`;
const M = (x: number, y: number, rot = 0) => ({ m00: Math.cos(rot), m01: -Math.sin(rot), m02: x, m10: Math.sin(rot), m11: Math.cos(rot), m12: y });
const color = (r: number, g: number, b: number, a = 1) => ({ r, g, b, a });
const g = (s: number, l: number) => ({ sessionID: s, localID: l });

export function clipboardHtml(): string {
  const triangle = new Uint8Array(1 + 8 + 1 + 8 + 1 + 8 + 1);
  const dv = new DataView(triangle.buffer);
  let o = 0; const cmd = (c: number, ...f: number[]) => { triangle[o++] = c; for (const v of f) { dv.setFloat32(o, v, true); o += 4; } };
  cmd(1, 0, 40); cmd(2, 40, 40); cmd(2, 20, 0); cmd(0);
  const message = {
    nodeChanges: [
      { guid: g(0, 0), type: 'DOCUMENT', name: 'Document' },
      { guid: g(0, 1), type: 'CANVAS', name: 'Page 1', parentIndex: { guid: g(0, 0), position: '!' } },
      { guid: g(1, 2), parentIndex: { guid: g(0, 1), position: 'a' }, type: 'FRAME', name: 'Card', size: { x: 200, y: 120 }, transform: M(100, 50), fillPaints: [{ type: 'SOLID', color: color(1, 1, 1), opacity: 1, visible: true }], cornerRadius: 8, effects: [{ type: 'DROP_SHADOW', color: color(0, 0, 0, 0.25), offset: { x: 0, y: 4 }, radius: 12, visible: true }] },
      { guid: g(1, 3), parentIndex: { guid: g(1, 2), position: 'a' }, type: 'RECTANGLE', name: 'Bar', size: { x: 160, y: 20 }, transform: M(20, 20), cornerRadius: 4, fillPaints: [{ type: 'GRADIENT_LINEAR', opacity: 1, visible: true, transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }, stops: [{ color: color(1, 0, 0), position: 0 }, { color: color(0, 0, 1), position: 1 }] }] },
      { guid: g(1, 4), parentIndex: { guid: g(1, 2), position: 'b' }, type: 'TEXT', name: 'Title', size: { x: 120, y: 24 }, transform: M(20, 60), fontSize: 18, fontName: { family: 'Inter', style: 'Semi Bold' }, lineHeight: { value: 150, units: 'PERCENT' }, letterSpacing: { value: 2, units: 'PIXELS' }, textData: { characters: 'Hello Figma' }, fillPaints: [{ type: 'SOLID', color: color(0.1, 0.2, 0.3), opacity: 1, visible: true }] },
      { guid: g(1, 5), parentIndex: { guid: g(1, 2), position: 'c' }, type: 'VECTOR', name: 'Tri', size: { x: 40, y: 40 }, transform: M(140, 60, Math.PI / 6), fillPaints: [{ type: 'SOLID', color: color(0, 1, 0), opacity: 0.5, visible: true }], fillGeometry: [{ commandsBlob: 0 }] },
      { guid: g(1, 6), parentIndex: { guid: g(0, 1), position: 'b' }, type: 'ELLIPSE', name: 'Dot', size: { x: 30, y: 30 }, transform: M(400, 60), fillPaints: [{ type: 'IMAGE', opacity: 1, visible: true }] },
    ],
    blobs: [{ bytes: triangle }],
  };
  const schema = parseSchema(SCHEMA);
  const compiled = compileSchema(schema) as any;
  const parts = [deflateSync(encodeBinarySchema(schema)), deflateSync(compiled.encodeMessage(message))];
  const total = 12 + parts.reduce((n, p) => n + 4 + p.length, 0);
  const buf = new Uint8Array(total); const view = new DataView(buf.buffer);
  buf.set(new TextEncoder().encode('fig-kiwi')); view.setUint32(8, 15, true);
  let off = 12; for (const p of parts) { view.setUint32(off, p.length, true); off += 4; buf.set(p, off); off += p.length; }
  const b64 = btoa(String.fromCharCode(...buf));
  return `<meta charset="utf-8"><span data-metadata="<!--(figmeta)eyJmaWxlS2V5IjoieCJ9-->"></span><span data-buffer="<!--(figma)${b64}-->"></span>`;
}

