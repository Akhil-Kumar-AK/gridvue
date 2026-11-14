import { DocStore, addNode, createEmptyDocument, defaultNode, pageIds, solid, type DocumentData } from '@layr/core';

export const TEMPLATES: { id: string; name: string; build: () => DocumentData }[] = [
  {
    id: 'phone', name: 'Mobile screen (390×844)',
    build() {
      const s = new DocStore(createEmptyDocument()); const page = pageIds(s.doc)[0];
      const f = defaultNode('FRAME', { name: 'Screen', width: 390, height: 844 }); addNode(s, f, page);
      const bar = defaultNode('RECT', { name: 'Header', width: 390, height: 96, fills: [solid('#7C5CFF')] }); addNode(s, bar, f.id);
      const t = defaultNode('TEXT', { name: 'Title', x: 20, y: 52 }); t.text = { ...t.text!, characters: 'Title', fontSize: 24, fontWeight: 700 }; t.fills = [solid('#FFFFFF')]; t.width = 80; t.height = 29; addNode(s, t, f.id);
      return s.doc;
    },
  },
  {
    id: 'poster', name: 'Poster (1080×1350)',
    build() {
      const s = new DocStore(createEmptyDocument()); const page = pageIds(s.doc)[0];
      const f = defaultNode('FRAME', { name: 'Poster', width: 1080, height: 1350, fills: [{ type: 'LINEAR', angle: 90, opacity: 1, visible: true, stops: [{ pos: 0, color: '#1B1B3A', opacity: 1 }, { pos: 1, color: '#693668', opacity: 1 }] }] }); addNode(s, f, page);
      addNode(s, defaultNode('ELLIPSE', { name: 'Sun', x: 340, y: 300, width: 400, height: 400, fills: [solid('#FFB86B')] }), f.id);
      const t = defaultNode('TEXT', { name: 'Headline', x: 80, y: 900, width: 920, height: 120 }); t.text = { ...t.text!, characters: 'Headline goes here', fontSize: 96, fontWeight: 800, resize: 'AUTO_HEIGHT' }; t.fills = [solid('#FFFFFF')]; addNode(s, t, f.id);
      return s.doc;
    },
  },
];
