// src/cockpit/topicKey.ts — the thread key of a topic he names, as Talk and Share both open it.
import { threadKey } from '../services/threads';

export function topicKey(name: string): string {
  return threadKey({ topic: name.trim() })!;
}
