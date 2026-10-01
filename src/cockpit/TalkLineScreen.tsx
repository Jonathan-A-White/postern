// src/cockpit/TalkLineScreen.tsx — the Talk line (?v=line, docs/protocol.md §20):
// he holds a big button and speaks, the phone buzzes, he lets go, the Mayor's short
// answer shows and is spoken, and a tap cuts it off. The model for the talk is a chip
// (Opus, Sonnet or Fable) and each answered turn says how soon its first words came.
// What the screen does is in useTalkLine; this only draws it.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Button, Chip, Icon, cx } from '../ui';
import { Screen } from './Shell';
import { useTalkLine } from './useTalkLine';
import { useCallLine } from './hooks';
import { sendCallRequest } from './send';
import { now } from '../services/clock';
import { callSentAt, clockHHMM } from '../model/call';
import { beadHref } from '../nav/route';
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

  // True from a smooth scroll to the end until it arrives, he touches the list or the list
  // moves up (a glide only goes down), so the scroll events on the way do not read as him
  // leaving the end.
  const gliding = useRef(false);
  const lastTop = useRef(0);
  const toEnd = () => {
    const el = scroller.current;
    gliding.current = true;
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

  // The list changes height under the end when the controls below it grow or shrink (the
  // status line wraps, a button appears) and when an answer's text settles: stay on the end.
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (nearEnd.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_END_PX;
    if (near || el.scrollTop < lastTop.current) gliding.current = false;
    lastTop.current = el.scrollTop;
    if (!near && gliding.current) return;
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
  const onTouch = () => {
    gliding.current = false;
  };
  return { scroller, onScroll, onTouch, pill, showNew };
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

/** Which microphone the hold is on: the Bluetooth input chosen (his car's, say), or the phone's default. */
function micName(input: string | undefined): string {
  return input ? `Listening on the Bluetooth microphone: ${input}.` : "Listening on the phone's own microphone.";
}

/** The small mark of whether the Mayor is here: a coloured dot, or a grey one while no wait of his is connected. Nothing until the backend has said. */
function PresenceMark({ here }: { here: boolean | undefined }) {
  if (here === undefined) return null;
  return (
    <p data-testid="mayor-presence" data-here={here} className="flex items-center justify-center gap-1.5 text-[11.5px] text-faint">
      <span aria-hidden className={cx('inline-block h-2 w-2 rounded-full', here ? 'bg-done' : 'bg-faint/50')} />
      {here ? 'Mayor here' : 'Mayor away'}
    </p>
  );
}

const CALL_ME = 'Call me';

/**
 * Leaves the Mayor a note to call him back (docs/protocol.md §21): a tap opens a short
 * field, prefilled "Call me", and Send delivers it as a call record. Under the presence mark
 * it says "Call sent HH:MM" until the Mayor rings or answers.
 */
function CallMe({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState(CALL_ME);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!open) return null;
  const send = () => {
    const words = text.trim();
    if (words === '' || sending) return;
    setSending(true);
    setFailed(false);
    sendCallRequest(words, Math.floor(now() / 1000)).then(
      () => {
        setSending(false);
        setText(CALL_ME);
        onClose();
      },
      () => {
        setSending(false);
        setFailed(true);
      },
    );
  };
  return (
    <form
      data-testid="call-me-form"
      className="flex w-full max-w-xl flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <input
        aria-label="What to tell the Mayor"
        value={text}
        maxLength={500}
        autoFocus
        disabled={sending}
        onChange={(event) => setText(event.target.value)}
        className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-[15px]"
      />
      {failed && <p className="text-[12.5px] text-danger">Could not send. Try again.</p>}
      <span className="flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={sending} onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={sending || text.trim() === ''}>
          {sending ? 'Sending…' : 'Send'}
        </Button>
      </span>
    </form>
  );
}

export function TalkLineScreen() {
  const talk = useTalkLine();
  const { line } = talk;
  const { scroller, onScroll, onTouch, pill, showNew } = useFollowEnd(talk.log);
  const listening = line.phase === 'listening';
  const dead = !talk.supported || line.phase === 'sending' || line.phase === 'waiting';
  const micOpen = talk.mic === 'ready';
  const label = buttonLabel(line.phase, talk.supported, micOpen);
  const [calling, setCalling] = useState(false);
  const callSent = callSentAt(useCallLine());

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
        <div ref={scroller} onScroll={onScroll} onWheel={onTouch} onTouchStart={onTouch} onPointerDown={onTouch} data-testid="talk-scroll" className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4">
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
                    {entry.links && entry.links.length > 0 && (
                      <span className="flex flex-wrap gap-1.5" data-testid="talk-links">
                        {entry.links.map((id) => (
                          <a
                            key={id}
                            href={beadHref(id)}
                            className="inline-flex min-h-8 max-w-full items-center rounded-lg border border-line bg-surface px-2.5 py-1 font-mono text-[12.5px] text-fg hover:border-line-strong"
                          >
                            <span className="truncate">{id}</span>
                          </a>
                        ))}
                      </span>
                    )}
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

      <div data-testid="talk-controls" className="flex shrink-0 flex-col items-center gap-3 border-t border-line bg-canvas px-4 pt-3 pb-4">
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
          {listening && micOpen && (
            <p data-testid="mic-name" className="text-[11.5px] text-faint">
              {micName(talk.input)}
            </p>
          )}
          {listening && micOpen && talk.mode === 'on-device' && <p className="text-[11.5px] text-faint">Speech is recognised on this phone.</p>}
        </div>
        <PresenceMark here={talk.here} />
        {callSent !== undefined && (
          <p data-testid="call-sent" className="text-center text-[11.5px] text-faint">
            Call sent {clockHHMM(callSent)}
          </p>
        )}

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

        <CallMe open={calling} onClose={() => setCalling(false)} />

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
          <Button variant="ghost" disabled={calling} onClick={() => setCalling(true)}>
            {CALL_ME}
          </Button>
          <Button variant="ghost" disabled={!talk.canEnd} onClick={talk.end}>
            End talk
          </Button>
        </div>
      </div>
    </Screen>
  );
}
