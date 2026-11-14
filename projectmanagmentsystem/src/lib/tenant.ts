import { getDb } from './db';
import { notFound, unauthorized } from './errors';
import { uid } from './crypto';
import type { Row, TenantCollection } from './types';

/**
 * THE TENANT GUARD.
 *
 * This is the only way application code touches tenant-owned collections. The
 * workspaceId is bound once, from the authenticated session — never from request
 * input — and is injected into every read, insert, update and delete:
 *
 *   - list/get only ever see rows whose workspaceId matches
 *   - insert stamps the workspaceId, overwriting anything the caller passed
 *   - update strips workspaceId from patches so rows can't be moved between tenants
 *   - rows from another workspace are reported as 404 (not 403) so ids aren't confirmed
 *
 * This mirrors a Mongoose plugin that adds { workspaceId } to every query.
 */
export function tenantRepo(workspaceId: string) {
  if (!workspaceId) throw unauthorized('No workspace in session');
  const db = getDb();

  const table = <K extends TenantCollection>(col: K) => db[col] as Row<K>[];

  return {
    workspaceId,

    list<K extends TenantCollection>(col: K, where?: (r: Row<K>) => boolean): Row<K>[] {
      return table(col).filter((r) => r.workspaceId === workspaceId && (!where || where(r)));
    },

    find<K extends TenantCollection>(col: K, where: (r: Row<K>) => boolean): Row<K> | undefined {
      return table(col).find((r) => r.workspaceId === workspaceId && where(r));
    },

    get<K extends TenantCollection>(col: K, id: string): Row<K> {
      const row = table(col).find((r) => r.id === id && r.workspaceId === workspaceId);
      if (!row) throw notFound(`${col.replace(/s$/, '')} not found`);
      return row;
    },

    insert<K extends TenantCollection>(col: K, data: Omit<Row<K>, 'id' | 'workspaceId'> & { id?: string }): Row<K> {
      const { workspaceId: _ignored, ...rest } = data as Record<string, unknown>;
      void _ignored;
      const row = { ...rest, id: data.id ?? uid(col.slice(0, 3)), workspaceId } as unknown as Row<K>;
      table(col).push(row);
      return row;
    },

    update<K extends TenantCollection>(col: K, id: string, patch: Partial<Omit<Row<K>, 'id' | 'workspaceId'>>): Row<K> {
      const row = this.get(col, id);
      const { workspaceId: _w, id: _i, ...safe } = patch as Record<string, unknown>;
      void _w;
      void _i;
      Object.assign(row, safe);
      return row;
    },

    remove<K extends TenantCollection>(col: K, id: string) {
      this.get(col, id);
      const t = table(col);
      const idx = t.findIndex((r) => r.id === id && r.workspaceId === workspaceId);
      t.splice(idx, 1);
    },

    removeWhere<K extends TenantCollection>(col: K, where: (r: Row<K>) => boolean) {
      const t = table(col);
      for (let i = t.length - 1; i >= 0; i--) {
        if (t[i].workspaceId === workspaceId && where(t[i])) t.splice(i, 1);
      }
    },
  };
}

export type TenantRepo = ReturnType<typeof tenantRepo>;
