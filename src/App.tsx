import { Gate } from './gate';
import { KeyVault } from './key';
import { Compose } from './compose';
import { Inbox } from './inbox';
import { BeadScreen, ProjectScreen, ProjectsScreen, type BeadKind } from './projects';
import { NotificationSettingsScreen } from './settings';
import { ThreadScreen, ThreadsScreen } from './threads';
import { parseThreadKey } from './services/threads';
import { useScreenSearch } from './router';

const BEAD_KINDS: BeadKind[] = ['needs_you', 'landed', 'working'];

function isBeadKind(value: string | null): value is BeadKind {
  return BEAD_KINDS.includes(value as BeadKind);
}

// The app is one page: a query string (not a path segment) picks the screen so a
// static file server needs no extra rewrite rule to serve
// https://postern.allmymind.org/?screen=key. src/router.ts turns a click on a
// `?screen=` link into history.pushState instead of a page load, so useScreenSearch
// is what makes this component re-render on that new URL.
export function App() {
  const search = useScreenSearch();
  const params = new URLSearchParams(search);
  const screen = params.get('screen');

  if (screen === 'key') {
    return <KeyVault />;
  }

  if (screen === 'compose') {
    return <Compose />;
  }

  if (screen === 'inbox') {
    return <Inbox />;
  }

  if (screen === 'projects') {
    return <ProjectsScreen />;
  }

  if (screen === 'notifications') {
    return <NotificationSettingsScreen />;
  }

  if (screen === 'threads') {
    return <ThreadsScreen />;
  }

  if (screen === 'thread') {
    return <ThreadScreen threadRef={parseThreadKey(params.get('thread') ?? undefined)} />;
  }

  if (screen === 'project') {
    const epicId = params.get('epic');
    if (epicId) return <ProjectScreen epicId={epicId} />;
  }

  if (screen === 'bead') {
    const epicId = params.get('epic');
    const beadId = params.get('bead');
    const kind = params.get('kind');
    if (epicId && beadId && isBeadKind(kind)) {
      return <BeadScreen epicId={epicId} kind={kind} beadId={beadId} />;
    }
  }

  return <Gate />;
}
