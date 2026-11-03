// src/cockpit/PromptNote.tsx — what an empty prompt channel ('prompt:top5', opened by Edit
// on the Prompts screen) shows in place of "nothing said": the prompt's current body as an
// app-side quote, so he can say what to change. It is not a message and is never sent.
import { EmptyState, Spinner } from '../ui';
import { usePrompts } from './usePrompts';

export function PromptNote({ name }: { name: string }) {
  const { prompts, held, fresh } = usePrompts();
  const prompt = prompts?.find((candidate) => candidate.name === name);
  if (!prompt) {
    // Never "nothing" before the list has answered: the phone has not read its copy, or holds none and the first ask is out (mw-gq6.904).
    if (prompts === undefined && (!held || fresh === undefined)) {
      return (
        <p role="status" className="flex items-center justify-center gap-2 py-8 text-sm text-muted">
          <Spinner size={14} />
          Reading the prompt…
        </p>
      );
    }
    return (
      <EmptyState icon="talk" title="Nothing said here yet">
        Say what you want to change about /{name}; the Mayor answers in this channel.
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-testid="prompt-current">
      <p className="text-[12.5px] font-semibold text-muted">Current /{name}:</p>
      <blockquote className="border-l-2 border-line pl-3 text-[14px] whitespace-pre-wrap text-fg">{prompt.body}</blockquote>
      <p className="text-[13px] text-muted">Say what to change; the Mayor answers here.</p>
    </div>
  );
}
