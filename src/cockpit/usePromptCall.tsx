// src/cockpit/usePromptCall.tsx — a text beginning '/' is a call to a saved prompt: it is checked against the
// signature before it can go. What the composer shows of it rides on voice-kit's Composer (mw-06ggew.5): the
// 'Saved prompts' list and the error or 'Checking…' line on its top slot, the grey suggestion laid over the box
// (fieldOverlay; one tap, Tab or → takes it), Send greyed while it is checked or failed (sendBlocked), and after a
// failed check a Send that sends anyway once held (renderSend).
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { SendSlot } from 'voice-kit/composer';
import { Chip, IconButton } from '../ui';
import { focusQuietly } from '../ui/focus';
import { usePrompts } from './usePrompts';
import { beginsCall, checkPromptCall, halfTypedOption, matchPrompts, suggestNext } from '../model/prompts';
import { optionChip } from '../services/prompts';

/** How long Send is held, while grey from a failed check, before it sends anyway. */
const FORCE_SEND_MS = 600;

export interface PromptCall {
  /** The prompts on offer and what the check says, for the composer's top. */
  top: ReactNode;
  /** The grey suggestion over the box. */
  overlay: ReactNode;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Send waits: the prompts are being checked, or the call failed its check. */
  blocked: boolean;
  /** After a failed check: Send, greyed, that a hold sends anyway. */
  renderSend: ((slot: SendSlot) => ReactNode) | undefined;
}

/** The composer's text box, from anything inside the composer. */
function boxFrom(element: Element): HTMLTextAreaElement | null {
  return element.closest('[data-testid="composer"]')?.querySelector('textarea') ?? null;
}

/** Focuses the box with the caret after the words, once the box has re-rendered with them. */
function caretAtEnd(area: HTMLTextAreaElement | null) {
  if (!area) return;
  focusQuietly(area);
  requestAnimationFrame(() => area.setSelectionRange(area.value.length, area.value.length));
}

export function usePromptCall(text: string, setText: (text: string) => void): PromptCall {
  const call = text.trimStart();
  const calling = beginsCall(call);
  const { prompts, fresh } = usePrompts(calling);
  const offered = calling && prompts ? matchPrompts(call, prompts) : [];
  const verdict = calling && prompts ? checkPromptCall(call, prompts) : undefined;
  const checking = calling && prompts === undefined && fresh === undefined;
  // the grey text after the cursor: what one tap (or Tab, or →) adds to the box
  const suggestion = calling && prompts ? suggestNext(call, prompts) : undefined;
  // a half-typed option, or an option whose value is on offer in grey, is not an error yet (Send waits)
  const unfinished = suggestion !== undefined || (calling && prompts ? halfTypedOption(call, prompts) : false);
  const callError = verdict && !verdict.ok && offered.length === 0 && !unfinished ? verdict.error : undefined;
  const callFailed = verdict !== undefined && !verdict.ok;

  function takeSuggestion(area: HTMLTextAreaElement | null) {
    if (!suggestion) return;
    setText(text + suggestion.rest);
    caretAtEnd(area);
  }

  // a failed check only warns: holding the grey Send sends the text as typed anyway
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function releaseSend() {
    clearTimeout(holdTimer.current);
    holdTimer.current = undefined;
  }
  function holdSend(send: () => void) {
    releaseSend();
    holdTimer.current = setTimeout(() => {
      holdTimer.current = undefined;
      send();
    }, FORCE_SEND_MS);
  }
  useEffect(() => releaseSend, []);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const area = event.currentTarget;
    const atEnd = area.selectionStart === area.value.length && area.selectionEnd === area.value.length;
    if (suggestion && atEnd && (event.key === 'Tab' || event.key === 'ArrowRight') && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      takeSuggestion(area);
    }
  }

  const top = (
    <>
      {offered.length > 0 && (
        <div role="listbox" aria-label="Saved prompts" className="flex max-h-56 flex-col overflow-y-auto border-b border-line">
          {offered.map((prompt) => (
            <button
              key={prompt.name}
              type="button"
              role="option"
              aria-selected={false}
              className="flex flex-col gap-1 px-4 py-2 text-left active:bg-sunken"
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                setText(`/${prompt.name} `);
                caretAtEnd(boxFrom(event.currentTarget));
              }}
            >
              <span className="font-mono text-[14px] font-semibold">/{prompt.name}</span>
              <span className="text-[13px] text-muted">{prompt.summary}</span>
              {prompt.signature.length > 0 && (
                <span className="flex flex-wrap gap-1.5">
                  {prompt.signature.map((option) => (
                    <Chip key={option.flag} mono tone={option.required ? 'needs' : 'neutral'}>
                      {optionChip(option)}
                    </Chip>
                  ))}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {callError && (
        <p role="alert" className="px-4 pt-2 text-[12.5px] text-danger">
          {callError}
        </p>
      )}
      {checking && (
        <p role="status" className="px-4 pt-2 text-[12.5px] text-muted">
          Checking the saved prompts…
        </p>
      )}
    </>
  );

  const overlay = suggestion && (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl border border-transparent px-3 py-2.5 text-base leading-snug wrap-anywhere whitespace-pre-wrap">
      <span className="invisible">{text}</span>
      <button
        type="button"
        data-testid="grey-suggestion"
        aria-label={`Add ${suggestion.text}`}
        tabIndex={-1}
        className="pointer-events-auto cursor-pointer text-faint"
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => takeSuggestion(boxFrom(event.currentTarget))}
      >
        {suggestion.rest}
      </button>
    </div>
  );

  const forceSend = ({ send }: SendSlot) => (
    <span
      data-testid="send-force"
      className="inline-flex shrink-0 touch-none select-none"
      onPointerDown={() => holdSend(send)}
      onPointerUp={releaseSend}
      onPointerLeave={releaseSend}
      onPointerCancel={releaseSend}
      onContextMenu={(event) => event.preventDefault()}
    >
      <IconButton icon="send" label="Send (hold to send anyway)" tone="accent" size="lg" disabled className="pointer-events-none [-webkit-touch-callout:none]" />
    </span>
  );

  return { top, overlay, onKeyDown, blocked: checking || callFailed, renderSend: callFailed ? forceSend : undefined };
}
