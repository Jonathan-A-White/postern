// mw-gq6.362: a jest-dom text or state matcher asserted once on a findBy*/findAllBy* result races the
// effect it waits for (mw-tfne4.38; refused mw-jtzpw0.7 twice). The lint refuses it.
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
// @ts-expect-error a plain JS module with no types
import rule from '../../eslint-rules/no-oneshot-find-assert.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });

tester.run('no-oneshot-find-assert', rule, {
  valid: [
    { code: "async function t() { expect(await screen.findByText('x')).toBeInTheDocument(); }" },
    { code: "async function t() { await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('x')); }" },
    { code: "async function t() { const s = await screen.findByRole('status'); expect(s).toBeInTheDocument(); }" },
    { code: "async function t() { const s = await screen.findByRole('status'); await waitFor(() => expect(s).toHaveTextContent('x')); }" },
    { code: "async function t() { await waitFor(async () => { expect(await screen.findByRole('b')).toBeDisabled(); }); }" },
    { code: "async function t() { expect(await screen.findAllByTestId('r')).toHaveLength(1); }" },
    { code: "async function t() { expect(screen.getByRole('status')).toHaveTextContent('x'); }" },
  ],
  invalid: [
    {
      code: "async function t() { expect(await screen.findByRole('status')).toHaveTextContent('x'); }",
      errors: [{ messageId: 'oneShot' }],
    },
    {
      code: "async function t() { const s = await screen.findByRole('status'); expect(s).toHaveTextContent('x'); }",
      errors: [{ messageId: 'oneShot' }],
    },
    {
      code: "async function t() { expect(await findByRole('button')).not.toBeDisabled(); }",
      errors: [{ messageId: 'oneShot' }],
    },
    {
      code: "async function t() { const [a] = [await view.findByRole('textbox')]; expect(await view.findByRole('textbox')).toHaveValue('y'); }",
      errors: [{ messageId: 'oneShot' }],
    },
    {
      code: "async function t() { const rows = await screen.findAllByRole('row'); expect(rows[0]).toHaveAttribute('aria-selected', 'true'); }",
      errors: [{ messageId: 'oneShot' }],
    },
    {
      code: "async function t() { const b = await screen.findByRole('checkbox'); expect(b).toBeChecked(); expect(b).toBeEnabled(); }",
      errors: [{ messageId: 'oneShot' }, { messageId: 'oneShot' }],
    },
  ],
});
