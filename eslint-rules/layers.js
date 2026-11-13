// mw-6ww.175.11 (B8, B12): hold the layers of src. Options: { layers, inversions }.
//   layers:     an ordered list, lowest first, of groups of top-level directories under src/ (a group is one
//               layer; imports inside a group are free). A directory in no group is unconstrained.
//   inversions: the imports that go UP a layer today, each 'src/<importer file> -> src/<resolved import>'
//               with the import's extension left off. An upward import not on the list is refused.
// The list lives in eslint-rules/layer-inversions.js and tests/unit/layers.test.ts keeps it from growing.
import path from 'node:path';

const rankOf = (layers, rel) => {
  const parts = rel.split('/');
  if (parts[0] !== 'src' || parts.length < 3) return -1;
  return layers.findIndex((group) => group.includes(parts[1]));
};

const toRel = (abs, root) => path.relative(root, abs).split(path.sep).join('/');

export const inversionKey = (importerRel, targetRel) => `${importerRel} -> ${targetRel.replace(/\.(tsx?|jsx?)$/, '')}`;

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Refuse an import that goes up a layer of src unless it is on the list of allowed inversions' },
    schema: [
      {
        type: 'object',
        properties: {
          layers: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
          inversions: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      inversion:
        '{{from}} (layer {{fromLayer}}) imports {{to}} (layer {{toLayer}}), which is above it. Move what it needs down, or pass it in; do not add to the list in eslint-rules/layer-inversions.js.',
    },
  },
  create(context) {
    const { layers = [], inversions = [] } = context.options[0] ?? {};
    const allowed = new Set(inversions);
    const root = context.cwd ?? process.cwd();
    const importerRel = toRel(context.filename, root);
    const fromRank = rankOf(layers, importerRel);
    if (fromRank < 0) return {};

    const check = (node, source) => {
      if (typeof source !== 'string' || !source.startsWith('.')) return;
      const targetRel = toRel(path.resolve(path.dirname(context.filename), source), root);
      const toRank = rankOf(layers, targetRel);
      if (toRank <= fromRank) return;
      if (allowed.has(inversionKey(importerRel, targetRel))) return;
      context.report({
        node,
        messageId: 'inversion',
        data: { from: importerRel, to: targetRel, fromLayer: layers[fromRank].join('/'), toLayer: layers[toRank].join('/') },
      });
    };

    return {
      ImportDeclaration: (node) => check(node.source, node.source.value),
      ExportNamedDeclaration: (node) => node.source && check(node.source, node.source.value),
      ExportAllDeclaration: (node) => check(node.source, node.source.value),
      ImportExpression: (node) => node.source.type === 'Literal' && check(node.source, node.source.value),
    };
  },
};
