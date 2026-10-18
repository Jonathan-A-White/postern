// tests/unit/router.test.tsx — mw-t64a3.21: a click on a link to this app's own
// origin is an in-app route change (history.pushState), never a page load.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { goBack, inAppHref } from '../../src/router';

function anchor(href: string, target?: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.setAttribute('href', href);
  if (target) a.target = target;
  a.textContent = 'link';
  document.body.appendChild(a);
  return a;
}

function click(a: HTMLAnchorElement, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  a.dispatchEvent(event);
  return event;
}

describe('router link clicks', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('takes a click on an own-origin absolute link as pushState({app:true}) with its search, not a page load', () => {
    const push = vi.spyOn(window.history, 'pushState');
    const event = click(anchor(`${window.location.origin}/?v=bead&id=mw-x`));

    expect(event.defaultPrevented).toBe(true);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith({ app: true }, '', '/?v=bead&id=mw-x');
    expect(window.location.search).toBe('?v=bead&id=mw-x');
  });

  it('still takes a relative ?v= link as pushState({app:true})', () => {
    const push = vi.spyOn(window.history, 'pushState');
    const event = click(anchor('?v=needs'));

    expect(event.defaultPrevented).toBe(true);
    expect(push).toHaveBeenCalledWith({ app: true }, '', '?v=needs');
  });

  it('leaves a link to another origin, a target=_blank link and a modified click to the browser', () => {
    const push = vi.spyOn(window.history, 'pushState');

    expect(click(anchor('https://example.org/?v=needs')).defaultPrevented).toBe(false);
    expect(click(anchor(`${window.location.origin}/?v=needs`, '_blank')).defaultPrevented).toBe(false);
    expect(click(anchor(`${window.location.origin}/?v=needs`), { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });
});

// mw-ev7oyy.40: a link to another app is the phone's to hand over, never a route of this one.
describe('links to another app', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const OTHER_APPS = [
    'kindle://book?action=open&asin=B0C74TJ712',
    'intent://scan/#Intent;scheme=zxing;package=com.google.zxing.client.android;end',
    'tel:+15555550123',
    'sms:+15555550123?body=Hello',
    'smsto:+15555550123',
    'mailto:me@example.org',
    'audible://library',
    'geo:0,0?q=Home',
    'someapp://?v=needs',
  ];

  it.each(OTHER_APPS)('%s is not an in-app route and its click is left to the phone', (href) => {
    const push = vi.spyOn(window.history, 'pushState');
    expect(inAppHref(href)).toBeNull();
    expect(click(anchor(href)).defaultPrevented).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });
});

describe('goBack', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('on a cold open (no history state) replaces the page with the fallback route', () => {
    window.history.replaceState(null, '', '/?v=bead&id=mw-x');
    const back = vi.spyOn(window.history, 'back');
    const replace = vi.spyOn(window.history, 'replaceState');
    goBack({ view: 'map', focus: 'mw-p' });
    expect(back).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith(null, '', '?v=map&focus=mw-p');
    expect(window.location.search).toBe('?v=map&focus=mw-p');
  });

  it('after an in-app move goes back in history instead', () => {
    window.history.pushState({ app: true }, '', '/?v=bead&id=mw-x');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    goBack({ view: 'map', focus: 'mw-p' });
    expect(back).toHaveBeenCalledTimes(1);
  });
});
