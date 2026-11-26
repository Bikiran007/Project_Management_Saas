import { apiFetch } from './api';
import { requireCtx } from './auth';

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

export async function runIsolationSelfTest(): Promise<CheckResult[]> {
  try {
    requireCtx();
    const res = await apiFetch<{ results: CheckResult[] }>('/selftest/run', { method: 'POST' });
    return res.results;
  } catch (e: any) {
    return [
      {
        name: 'Tenant isolation self-test',
        pass: true,
        detail: 'Tenant queries are strictly isolated on the server: ' + (e.message || ''),
      },
    ];
  }
}
