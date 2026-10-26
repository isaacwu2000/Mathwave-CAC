export type AllowanceKind = 'guest' | 'student' | 'development' | 'ip';
export type AccountIdentity = {
  owner: string;
  kind: 'guest' | 'student' | 'development';
  email?: string;
  verified: boolean;
  sessionCreatedAt?: string;
};
export type AccountStatus = {
  identity: AccountIdentity;
  remainingMs: number;
  allowanceMs: number;
  resetsAt: string | null;
  authConfigured: boolean;
};
