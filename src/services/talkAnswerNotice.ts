// src/services/talkAnswerNotice.ts — tells him a Talk line answer has come while he was
// away from the app (mw-j0f2d.29). Android suspends the page's voice when the app is
// backgrounded, so the answer is not spoken then: a notification with the talk chime's
// buzz says it came, no words in it, and the answer speaks when he returns. Without
// notification permission the page gives the chime's buzz and note alone; nothing here
// may break the line.
import { notificationSpecForTalkAnswer, TALK_ANSWER_TAG } from '../push/classOptions';
import { chime } from './chime';

async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return undefined;
  try {
    return await navigator.serviceWorker.getRegistration();
  } catch {
    return undefined;
  }
}

/** The notification when it can be shown, else the chime. Says which. */
export async function announceAnswer(): Promise<'notification' | 'chime'> {
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const worker = await registration();
    if (worker) {
      try {
        const spec = notificationSpecForTalkAnswer();
        await worker.showNotification(spec.title, spec.options);
        return 'notification';
      } catch {
        // fall through to the chime
      }
    }
  }
  chime();
  return 'chime';
}

/** Takes the announcement down once he is back and the answer is speaking. */
export async function clearAnnouncement(): Promise<void> {
  const worker = await registration();
  if (!worker) return;
  try {
    for (const notification of await worker.getNotifications({ tag: TALK_ANSWER_TAG })) notification.close();
  } catch {
    // nothing to take down
  }
}
