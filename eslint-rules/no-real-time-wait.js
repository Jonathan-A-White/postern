// no-real-time-wait: a test does not sleep in real time (mw-t5shinh.6).
// It refuses page.waitForTimeout(...), a new Promise that resolves on setTimeout, and a call of sleep/delay/pause with a number
// or a name ending _MS, unless the line or the line above says why: '// a real-time wait: <reason>' ('// a real-time hold:' counts too).

const HELPERS = new Set(['sleep', 'delay', 'pause']);
const MARK = /\/\/ a real-time (?:wait|hold):\s*\S/;

const MESSAGE =
  'A real-time sleep makes a test flaky on a loaded host. Fix it in this order: ' +
  '1. wait on the condition (expect.poll, findBy, waitFor); ' +
  '2. drive the page clock (page.clock) or vi fake timers; ' +
  "3. only for a window in which nothing must happen, mark the line '// a real-time wait: <reason>'. " +
  'Not a shorter timeout, a loop on Date.now or a helper under another name.';

const isNumberOrMs = (node) => {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'Literal') return typeof node.value === 'number';
  if (node.type === 'Identifier') return /_MS$/.test(node.name);
  if (node.type === 'BinaryExpression' || node.type === 'LogicalExpression') {
    return isNumberOrMs(node.left) || isNumberOrMs(node.right);
  }
  if (node.type === 'UnaryExpression') return isNumberOrMs(node.argument);
  if (node.type === 'TSAsExpression' || node.type === 'TSNonNullExpression') return isNumberOrMs(node.expression);
  return false;
};

const calleeName = (callee) => {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') return callee.property.name;
  return null;
};

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Refuse a new real-time sleep in a test unless its line says why' },
    schema: [],
    messages: { sleep: MESSAGE },
  },
  create(context) {
    const source = context.sourceCode;
    const marked = (node) => {
      const line = node.loc.start.line;
      return [line, line - 1].some((n) => n >= 1 && MARK.test(source.lines[n - 1] ?? ''));
    };
    const report = (node) => {
      if (!marked(node)) context.report({ node, messageId: 'sleep' });
    };
    return {
      CallExpression(node) {
        const name = calleeName(node.callee);
        if (name === 'waitForTimeout') return report(node);
        if (node.callee.type === 'Identifier' && HELPERS.has(name) && isNumberOrMs(node.arguments[0])) report(node);
      },
      NewExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'Promise') return;
        const fn = node.arguments[0];
        if (!fn || !/\bsetTimeout\s*\(/.test(source.getText(fn))) return;
        report(node);
      },
    };
  },
};
