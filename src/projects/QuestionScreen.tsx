// src/projects/QuestionScreen.tsx — mw-f758y.2's "Question screen" and "Reply"
// paragraphs: the question, its recommended answer, a button per option (the
// recommended one marked) and a free-text box; a tap or Send builds the §6 reply
// and sends it like any message to the Mayor's key, records it in the answers
// table, and shows the txid. The Play control (Web Speech API) is mw-tfne4.6.
import { useState } from 'react';
import { answersRepo } from '../data/repositories';
import { encodeReply, type QuestionBody } from '../services/questions';
import { sendTextMessage } from '../services/send';

export interface QuestionScreenProps {
  question: QuestionBody;
  /** The sender's raw 32-byte master key, as unlocked from the vault. */
  unlockedKey: Uint8Array;
  recipientPublicKeyHex: string;
  onAnswered?: () => void;
}

type SendState =
  | { name: 'idle' }
  | { name: 'sending' }
  | { name: 'sent'; txid: string }
  | { name: 'error'; message: string };

export function QuestionScreen({ question, unlockedKey, recipientPublicKeyHex, onAnswered }: QuestionScreenProps) {
  const [text, setText] = useState('');
  const [sendState, setSendState] = useState<SendState>({ name: 'idle' });

  async function sendAnswer(answer: string): Promise<void> {
    if (answer.trim().length === 0 || sendState.name === 'sending') return;
    setSendState({ name: 'sending' });
    try {
      const txid = await sendTextMessage({
        text: encodeReply({ bead: question.bead, answer }),
        class: 'message',
        senderKey: unlockedKey,
        recipientPublicKeyHex,
      });
      await answersRepo.save({ bead: question.bead, answer, txid });
      setSendState({ name: 'sent', txid });
      setText('');
      onAnswered?.();
    } catch (err) {
      setSendState({ name: 'error', message: (err as Error).message });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p>{question.q}</p>
      <p>Recommended: {question.rec}</p>
      <ul className="flex flex-col gap-2">
        {question.options.map((option) => (
          <li key={option}>
            <button
              type="button"
              data-testid={`option-${option}`}
              className="w-full rounded bg-slate-700 px-4 py-2 text-left"
              disabled={sendState.name === 'sending'}
              onClick={() => void sendAnswer(option)}
            >
              {option}
              {option === question.rec ? ' (recommended)' : ''}
            </button>
          </li>
        ))}
      </ul>

      <label htmlFor="question-reply-text">Your own answer</label>
      <textarea id="question-reply-text" value={text} onChange={(e) => setText(e.target.value)} />
      <button
        type="button"
        className="rounded bg-slate-700 px-4 py-2"
        disabled={sendState.name === 'sending' || text.trim().length === 0}
        onClick={() => void sendAnswer(text)}
      >
        Send
      </button>

      {sendState.name === 'sending' && <p>Sending…</p>}
      {sendState.name === 'sent' && <p>Sent. Transaction id: {sendState.txid}</p>}
      {sendState.name === 'error' && (
        <p role="alert" className="text-red-400">
          {sendState.message}
        </p>
      )}
    </div>
  );
}
