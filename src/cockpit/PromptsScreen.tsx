// src/cockpit/PromptsScreen.tsx — the saved prompts (server/README.md): one row each with
// its name as '/top5', its summary and its signature as small chips. Run opens the general
// channel with the composer already saying '/top5 '; Edit opens the channel 'prompt:top5',
// a text conversation with the Mayor about changing it. The list is kept on the phone, so
// offline it shows with the time it was fetched.
import { Button, Card, Chip, EmptyState, Spinner } from '../ui';
import { Screen } from './Shell';
import { usePrompts } from './usePrompts';
import { navigate } from '../router';
import { GENERAL } from '../model/threads';
import { topicKey } from './topicKey';
import { clockHHMM } from '../model/call';
import { optionChip, promptChannel } from '../services/prompts';
import type { Prompt } from '../data/db';

function PromptRow({ prompt }: { prompt: Prompt }) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3" data-testid={`prompt-${prompt.name}`}>
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-[14.5px] font-semibold">/{prompt.name}</span>
        <span className="text-[13.5px] text-muted">{prompt.summary}</span>
      </div>
      {prompt.signature.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Options">
          {prompt.signature.map((option) => (
            <Chip key={option.flag} mono tone={option.required ? 'needs' : 'neutral'} title={option.help}>
              {optionChip(option)}
            </Chip>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" icon="send" onClick={() => navigate({ view: 'talk', thread: GENERAL, prefill: `/${prompt.name} ` })}>
          Run
        </Button>
        <Button size="sm" icon="talk" onClick={() => navigate({ view: 'talk', thread: topicKey(promptChannel(prompt.name)) })}>
          Edit
        </Button>
      </div>
    </li>
  );
}

export function PromptsScreen() {
  const { prompts, at, fresh, retry } = usePrompts();
  const offline = fresh === false && prompts !== undefined && at !== undefined;
  return (
    <Screen title="Prompts" subtitle="Saved prompts: Run one, or Edit it with the Mayor" back={{ view: 'me' }}>
      {prompts === undefined && fresh === undefined && (
        <p className="flex items-center gap-2 text-[13px] text-muted" role="status">
          <Spinner /> Loading the prompts…
        </p>
      )}
      {prompts === undefined && fresh === false && (
        <EmptyState icon="alarm" title="The prompts could not be fetched">
          <p>Nothing is kept on this phone yet. Check the connection, then try again.</p>
          <Button size="sm" icon="refresh" className="mt-3" onClick={retry}>
            Try again
          </Button>
        </EmptyState>
      )}
      {prompts !== undefined && (
        <div className="flex flex-col gap-3">
          {offline && (
            <p className="text-[13px] text-muted" role="status">
              The backend could not be reached; this is the list as of {clockHHMM(at / 1000)}.
            </p>
          )}
          {prompts.length === 0 ? (
            <EmptyState icon="sparkle" title="No saved prompts yet">
              Ask the Mayor to save one; it appears here.
            </EmptyState>
          ) : (
            <Card>
              <ul className="divide-y divide-line" data-testid="prompt-list">
                {prompts.map((prompt) => (
                  <PromptRow key={prompt.name} prompt={prompt} />
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </Screen>
  );
}
