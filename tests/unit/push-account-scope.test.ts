// mw-9rp4hu.23: which account a push registration belongs to is read off its scope.
import { describe, expect, it } from 'vitest';
import { accountForScope, scopeForAccount } from '../../src/push/accountScope';

describe('the scope of an account\'s push registration', () => {
  it('is the app\'s own scope (/) for account 1, and /push-account/<id>/ for every other', () => {
    expect(scopeForAccount('1')).toBe('/');
    expect(scopeForAccount('ab12cd34ef56')).toBe('/push-account/ab12cd34ef56/');
  });

  it('names the account back from a registration\'s scope', () => {
    expect(accountForScope('https://postern.allmymind.org/')).toBe('1');
    expect(accountForScope('https://postern.allmymind.org/push-account/2/')).toBe('2');
    expect(accountForScope('http://localhost:4173/push-account/ab12/')).toBe('ab12');
  });

  it('reads no scope as account 1', () => {
    expect(accountForScope(undefined)).toBe('1');
    expect(accountForScope('not a url')).toBe('1');
  });
});
