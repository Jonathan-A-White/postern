// src/cockpit/TalkSection.tsx — Me > Talk: how the mic is worked (Hold or Tap) and when a spoken message goes (On release or
// By button). Kept on the device; the compose bar and the Talk line read it at once (talkSettings.ts, mw-06ggew.6).
import { Card, SectionTitle } from '../ui';
import { Row } from './MeRow';
import { keepTalkSettings, useTalkSettings, type TalkSettings } from './talkSettings';

interface Group<K extends keyof TalkSettings> {
  key: K;
  label: string;
  choices: { value: TalkSettings[K]; label: string }[];
  says: string;
}

const TALK: Group<'talk'> = {
  key: 'talk',
  label: 'Talk',
  choices: [
    { value: 'hold', label: 'Hold' },
    { value: 'tap', label: 'Tap' },
  ],
  says: 'Hold: speak while you hold the bar. Tap: a quick tap keeps the mic on and the next tap stops it.',
};

const SEND: Group<'send'> = {
  key: 'send',
  label: 'Send',
  choices: [
    { value: 'release', label: 'On release' },
    { value: 'button', label: 'By button' },
  ],
  says: 'On release: letting go sends the words. By button: they wait in the box for you to fix, then Send.',
};

function Choice<K extends keyof TalkSettings>({ group, kept }: { group: Group<K>; kept: TalkSettings }) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <Row label={group.label}>
        <span role="radiogroup" aria-label={group.label} className="flex flex-wrap justify-end gap-2">
          {group.choices.map((choice) => (
            <label key={choice.value} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[13px]">
              <input
                type="radio"
                name={`talk-${group.key}`}
                className="h-4 w-4 accent-[var(--pc-accent)]"
                checked={kept[group.key] === choice.value}
                onChange={() => keepTalkSettings({ ...kept, [group.key]: choice.value })}
              />
              {choice.label}
            </label>
          ))}
        </span>
      </Row>
      <p className="text-[13px] text-muted">{group.says}</p>
    </div>
  );
}

export function TalkSection() {
  const kept = useTalkSettings();
  return (
    <section className="flex flex-col gap-2" aria-label="Talk">
      <SectionTitle>Talk</SectionTitle>
      <Card className="divide-y divide-line">
        <Choice group={TALK} kept={kept} />
        <Choice group={SEND} kept={kept} />
      </Card>
    </section>
  );
}
