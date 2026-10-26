'use client';
import { createContext, useContext } from 'react';
import type { AccountStatus } from '../types/index.ts';

export const AccountContext = createContext<{
  status: AccountStatus;
  refresh: () => Promise<void>;
} | null>(null);
export function useAccount() {
  return useContext(AccountContext);
}
