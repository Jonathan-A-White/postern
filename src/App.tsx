import { Gate } from './gate';
import { KeyVault } from './key';
import { Compose } from './compose';
import { Inbox } from './inbox';

// No router: the app is one page today. A query string (not a path segment)
// picks the screen so a static file server needs no extra rewrite rule to
// serve https://postern.allmymind.org/?screen=key.
export function App() {
  const screen = new URLSearchParams(window.location.search).get('screen');

  if (screen === 'key') {
    return <KeyVault />;
  }

  if (screen === 'compose') {
    return <Compose />;
  }

  if (screen === 'inbox') {
    return <Inbox />;
  }

  return <Gate />;
}
