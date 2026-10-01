// src/cockpit/TalkLineScreen.tsx — the Talk line (?v=line, docs/protocol.md §20):
// he holds a big button and speaks, the phone buzzes, he lets go, the Mayor's short
// answer shows and is spoken, and a tap cuts it off. The model for the talk is a chip
// (Opus, Sonnet or Fable) and each answered turn says how soon its first words came.
// What the screen does is in useTalkLine; this only draws it.
import { useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Button, Chip, Icon, cx } from '../ui';
import { Screen } from './Shell';
import { useTalkLine } from './useTalkLine';
import { formatSeconds, showsCutTag } from '../model/talkScreen';
import type { TalkPhase } from '../model/talkLine';
import type { TalkLogEntry } from '../model/talkScreen';

/** How far from the end of the list still counts as reading the end. */
const NEAR_END_PX = 48;

/** Names the newest answer on the page, so a holding reply and the real one after it each count as new. */
function answerKey(log: TalkLogEntry[]): string {
  for (let i = log.length - 1; i >= 0; i--) {
    const answer = log[i].answer;
    if (answer !== undefined) return `${log[i].turn}:${answer}`;
  }
  return '';
}

/**
 * Keeps the newest turn in view. His own turn always takes him to the end. The
 * Mayor's answer takes him there too while he is reading the end; if he has
 * scrolled up to read older turns it leaves him where he is and raises a pill.
 */
function useFollowEnd(log: TalkLogEntry[]) {
  const scroller = useRef<HTMLDivElement>(null);
  const nearEnd = useRef(true);
  const [atEnd, setAtEnd] = useState(true);
  const [pill, setPill] = useState(false);
  const turns = log.length;
  const answer = answerKey(log);
  // Set while rendering, from what changed since the last render (the pill is state of the page, not an effect).
  const [seen, setSeen] = useState({ turns, answer });
  if (seen.turns !== turns || seen.answer !== answer) {
    setSeen({ turns, answer });
    if (turns > seen.turns) setPill(false);
    else if (answer !== seen.answer && !atEnd) setPill(true);
  }

  const toEnd = () => {
    const el = scroller.current;
    el?.scrollTo?.({ top: el.scrollHeight, behavior: 'smooth' });
  };
  const last = useRef({ turns, answer });
  useLayoutEffect(() => {
    const grew = turns > last.current.turns;
    const answered = answer !== last.current.answer;
    last.current = { turns, answer };
    if (grew || (answered && nearEnd.current)) {
      toEnd();
      nearEnd.current = true;
    }
  }, [turns, answer]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_END_PX;
    nearEnd.current = near;
    setAtEnd(near);
    if (near) setPill(false);
  };
  const showNew = () => {
    toEnd();
    nearEnd.current = true;
    setAtEnd(true);
    setPill(false);
  };
  return { scroller, onScroll, pill, showNew };
}

const MODELS = [
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'fable', label: 'Fable' },
];

const STATUS: Partial<Record<TalkPhase, string>> = {
  sending: 'Sending…',
  waiting: 'The Mayor is thinking…',
  speaking: 'The Mayor is speaking…',
};

/** What the big button says a hold will do (or why it cannot be held now). */
function buttonLabel(phase: TalkPhase, supported: boolean, micOpen: boolean): string {
  if (!supported) return 'Hold to talk';
  switch (phase) {
    case 'listening':
      return micOpen ? 'Release to send' : 'Starting the mic…';
    case 'sending':
      return 'Sending…';
    case 'waiting':
      return 'Waiting for the Mayor…';
    default:
      return 'Hold to talk';
  }
}

export function TalkLineScreen() {
  const talk = useTalkLine();
  const { line } = talk;
  const { scroller, onScroll, pill, showNew } = useFollowEnd(talk.log);
  const listening = line.phase === 'listening';
  const dead = !talk.supported || line.phase === 'sending' || line.phase === 'waiting';
  const micOpen = talk.mic === 'ready';
  const label = buttonLabel(line.phase, talk.supported, micOpen);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // a pointer that is already gone: the press still counts
    }
    talk.press();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (!event.repeat) talk.press();
  };
  const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === ' ' || event.key === 'Enter') void talk.release();
  };

  return (
    <Screen title="Talk" subtitle="A voice line to the Mayor" back={{ view: 'talk' }} bare>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={scroller} onScroll={onScroll} data-testid="talk-scroll" className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <ol className="mx-auto flex max-w-xl flex-col gap-4" data-testid="talk-log">
            {talk.log.map((entry) => (
              <li key={entry.turn} className="flex flex-col gap-2" data-testid="talk-turn">
                <div className="ml-auto flex max-w-[88%] flex-col items-end gap-1">
                  <p data-testid="talk-said" className="rounded-2xl bg-accent/15 px-3.5 py-2 text-[15px] break-words">
                    {entry.said}
                  </p>
                  <span className="flex gap-1.5">
                    {showsCutTag(entry) && <Chip>cut the last answer</Chip>}
                    {entry.asked && <Chip>asked for {entry.asked}</Chip>}
                  </span>
                </div>
                {entry.answer !== undefined && (
                  <div data-testid="talk-answer" className="mr-auto flex max-w-[88%] flex-col gap-1">
                    <p className="rounded-2xl border border-line bg-surface px-3.5 py-2 text-[15px] break-words">{entry.answer}</p>
                    <span className="flex flex-wrap gap-1.5 text-[11.5px] text-muted">
                      {entry.answeredBy && <Chip tone="working">{entry.answeredBy}</Chip>}
                      {entry.firstWordsMs !== undefined && <span className="tabular-nums">first words in {formatSeconds(entry.firstWordsMs)}</span>}
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
        {pill && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <Button size="sm" icon="down" className="pointer-events-auto shadow-lg" onClick={showNew}>
              New answer
            </Button>
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-3 border-t border-line bg-canvas px-4 pt-3 pb-4">
        <div role="status" aria-live="polite" className="min-h-[2.75rem] w-full max-w-xl text-center text-[14px]">
          {listening ? (
            <p data-testid="live-transcript" className="text-fg">
              {micOpen ? talk.transcript || 'Listening…' : 'Starting the mic…'}
            </p>
          ) : (
            <p className={cx(talk.notice ? 'text-danger' : 'text-muted')}>
              {talk.notice ?? STATUS[line.phase] ?? (talk.supported ? 'Hold the button and speak.' : '')}
            </p>
          )}
          {!talk.supported && <p className="text-danger">This browser cannot turn speech into text.</p>}
          {listening && micOpen && talk.mode === 'cloud' && (
            <p className="text-[11.5px] text-faint">
              {talk.fellBack
                ? 'Speech on this phone is not available, so your browser sends the audio to its speech service.'
                : 'Your browser sends the audio to its speech service.'}
            </p>
          )}
          {listening && micOpen && talk.mode === 'on-device' && <p className="text-[11.5px] text-faint">Speech is recognised on this phone.</p>}
        </div>

        <div role="group" aria-label="Model for this talk" className="flex items-center gap-2">
          {MODELS.map((model) => (
            <Button
              key={model.id}
              size="sm"
              variant={line.model === model.id ? 'primary' : 'secondary'}
              aria-pressed={line.model === model.id}
              disabled={line.phase !== 'idle'}
              onClick={() => talk.setModel(line.model === model.id ? undefined : model.id)}
            >
              {model.label}
            </Button>
          ))}
        </div>

        <button
          type="button"
          disabled={dead}
          onPointerDown={onPointerDown}
          onPointerUp={() => void talk.release()}
          onPointerCancel={talk.abort}
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          className={cx(
            'flex h-24 w-full max-w-xl touch-none flex-col items-center justify-center gap-1 rounded-3xl text-[16px] font-semibold transition-colors select-none [-webkit-touch-callout:none]',
            listening ? 'bg-needs text-canvas' : 'bg-accent text-accent-fg',
            'disabled:cursor-not-allowed disabled:opacity-45',
          )}
        >
          <Icon name="mic" size={26} />
          {label}
        </button>

        <div className="flex h-10 items-center gap-2">
          {line.phase === 'speaking' && (
            <Button icon="stop" onClick={talk.cut}>
              Cut the answer
            </Button>
          )}
          {line.phase === 'waiting' && <Button onClick={talk.cut}>Stop waiting</Button>}
          {line.phase === 'idle' && line.unsent && (
            <Button variant="primary" onClick={talk.retry}>
              Try again
            </Button>
          )}
          <Button variant="ghost" disabled={line.talk === undefined || line.phase === 'sending'} onClick={talk.end}>
            End talk
          </Button>
        </div>
      </div>
    </Screen>
  );
}
