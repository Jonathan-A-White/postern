// src/cockpit/AnswerBar.tsx — the Mayor answered on the Talk line while he was on another screen
// (mw-am3yjh.3): one line over whatever he is on; a tap opens the Talk line, which plays the answer.
import { Banner } from '../ui';
import { navigate } from '../router';
import { useAnswerWaiting } from '../services/answerWaiting';

export function AnswerBar() {
  const waiting = useAnswerWaiting();
  if (!waiting) return null;
  return (
    <section aria-label="The Mayor answered" className="shrink-0 px-2 pt-2">
      <Banner tone="needs" icon="talk">
        <button type="button" className="w-full text-left font-medium" onClick={() => navigate({ view: 'line' })}>
          Mayor answered, tap to hear
        </button>
      </Banner>
    </section>
  );
}
