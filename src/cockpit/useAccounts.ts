// src/cockpit/useAccounts.ts — the accounts and which one is active, for the screens that show them (mw-9rp4hu.5).
import { useSyncExternalStore } from 'react';
import { accountsRepo } from '../data/repositories';
import { getActiveAccount, onAccountChange, type Account } from '../services/accounts';
import { useLiveQuery } from './hooks';

const NONE: Account[] = [];

export function useActiveAccountId(): string {
  return useSyncExternalStore(onAccountChange, () => getActiveAccount().id, () => getActiveAccount().id);
}

/** Every account, in the order they were added; empty until the first read arrives. */
export function useAccounts(): { accounts: Account[]; activeId: string } {
  const activeId = useActiveAccountId();
  const accounts = useLiveQuery(() => accountsRepo.list(), [], NONE);
  return { accounts, activeId };
}
