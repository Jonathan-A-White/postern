// src/cockpit/PromptNote.tsx — what an empty prompt channel ('prompt:top5', opened by Edit
// on the Prompts screen) shows in place of "nothing said": the prompt's current body as an
// app-side quote, so he can say what to change. It is not a message and is never sent.
import { Spinner } from '../ui';
import type { ThreadRead } from './hooks';
import { NoPosts } from './NoPosts';
import { usePrompts } from './usePrompts';

export function PromptNote({ name, read }: { name: string; read: ThreadRead }) {
  const { prompts, held, fresh } = usePrompts();
  const prompt = prompts?.find((candidate) => candidate.name === name);
  if (!prompt) {
    // Nor "nothing" before the channel's own thread read has answered: it is the same read NoPosts waits on (mw-gq6.910).
    if (read !== 'empty') return <NoPosts read={read} />;
    // Never "nothing" before the list has answered: the phone has not read its copy, or holds none and the first ask is out (mw-gq6.904).
    if (prompts === undefined && (!held || fresh === undefined)) {
      return (
        <p role="status" className="flex items-center justify-center gap-2 py-8 text-sm text-muted">
          <Spinner size={14} />
          Reading the prompt…
        </p>
      );
    }
    return <NoPosts read={read} hint={`Say what you want to change about /${name}; the Mayor answers in this channel.`} />;
  }
  return (
    <div className="flex flex-col gap-2" data-testid="prompt-current">
      <p className="text-[12.5px] font-semibold text-muted">Current /{name}:</p>
      <blockquote className="border-l-2 border-line pl-3 text-[14px] whitespace-pre-wrap text-fg">{prompt.body}</blockquote>
      <p className="text-[13px] text-muted">Say what to change; the Mayor answers here.</p>
    </div>
  );
}
