// mw-gq6.362: refuse a jest-dom text or state matcher asserted once on the result of a findBy*/findAllBy*
// query (directly, or on a variable bound from one) outside a waitFor callback. findBy* resolves as soon as
// the element EXISTS, not once it holds the text or state asserted next, so the assert races the effect and
// flakes under load (mw-tfne4.38; mw-jtzpw0.7 was refused for it twice).

const MATCHERS = new Set(['toHaveTextContent', 'toHaveValue', 'toBeDisabled', 'toBeEnabled', 'toBeChecked', 'toHaveAttribute']);

const calleeName = (callee) => {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') return callee.property.name;
  return null;
};

const isFindCall = (node) => {
  if (!node || node.type !== 'CallExpression') return false;
  const name = calleeName(node.callee);
  return name !== null && /^find(All)?By/.test(name);
};

const isAwaitedFind = (node) => node?.type === 'AwaitExpression' && isFindCall(node.argument);

const rootOf = (node) => {
  let n = node;
  while (n.type === 'MemberExpression') n = n.object;
  return n;
};

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Refuse a one-shot text or state assert on a findBy*/findAllBy* result' },
    schema: [],
    messages: {
      oneShot:
        '{{matcher}} asserted once on a findBy* result races the effect (findBy* resolves when the element exists, not when it holds the text or state). Wait for the text: findByText(...) or waitFor(() => expect(getBy...).{{matcher}}(...)).',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    const insideWaitFor = (node) => {
      for (let n = node.parent; n; n = n.parent) {
        if (
          (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression') &&
          n.parent?.type === 'CallExpression' &&
          n.parent.arguments.includes(n) &&
          calleeName(n.parent.callee) === 'waitFor'
        ) {
          return true;
        }
      }
      return false;
    };

    const boundFromFind = (identifier) => {
      let scope = sourceCode.getScope(identifier);
      while (scope) {
        const variable = scope.set.get(identifier.name);
        if (variable) {
          return variable.defs.some((d) => d.type === 'Variable' && d.node.id.type === 'Identifier' && isAwaitedFind(d.node.init));
        }
        scope = scope.upper;
      }
      return false;
    };

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier') return;
        const matcher = callee.property.name;
        if (!MATCHERS.has(matcher)) return;
        // peel `.not` / `.resolves` to reach expect(...)
        let target = callee.object;
        while (target.type === 'MemberExpression' && !target.computed) target = target.object;
        if (target.type !== 'CallExpression' || calleeName(target.callee) !== 'expect' || target.arguments.length === 0) return;
        const subject = target.arguments[0];
        const root = rootOf(subject);
        const fromFind = isAwaitedFind(root) || (root.type === 'Identifier' && boundFromFind(root));
        if (!fromFind || insideWaitFor(node)) return;
        context.report({ node: callee.property, messageId: 'oneShot', data: { matcher } });
      },
    };
  },
};
