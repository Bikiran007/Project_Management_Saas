import type { Request, Response, NextFunction } from 'express';

// Track failed login attempts per normalized email: 5 failed attempts -> 60s lockout
interface FailedAttempt {
  count: number;
  until: number;
}

const loginFailures = new Map<string, FailedAttempt>();
const MAX_FAILURES = 5;
const LOCKOUT_MS = 60_000;

export function checkLoginLockout(email: string): { locked: boolean; remainingSecs: number } {
  const norm = email.trim().toLowerCase();
  const record = loginFailures.get(norm);
  if (record && record.until > Date.now()) {
    const remainingSecs = Math.ceil((record.until - Date.now()) / 1000);
    return { locked: true, remainingSecs };
  }
  return { locked: false, remainingSecs: 0 };
}

export function recordLoginFailure(email: string): { locked: boolean; remainingSecs: number } {
  const norm = email.trim().toLowerCase();
  const record = loginFailures.get(norm) ?? { count: 0, until: 0 };
  record.count += 1;
  if (record.count >= MAX_FAILURES) {
    record.until = Date.now() + LOCKOUT_MS;
    record.count = 0;
    loginFailures.set(norm, record);
    return { locked: true, remainingSecs: 60 };
  }
  loginFailures.set(norm, record);
  return { locked: false, remainingSecs: 0 };
}

export function clearLoginFailure(email: string): void {
  loginFailures.delete(email.trim().toLowerCase());
}

export function resetAllLoginFailures(): void {
  loginFailures.clear();
}
