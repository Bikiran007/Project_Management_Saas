import { Activity, type IActivity } from '../db/models/index.js';
import { broadcastEvent } from './realtime.js';

export async function logActivity(params: {
  workspaceId: string;
  actorId: string;
  entityType: string;
  entityId: string;
  action: string;
  meta?: Record<string, any>;
  message?: string;
}): Promise<IActivity> {
  const act = await Activity.create({
    workspaceId: params.workspaceId,
    actorId: params.actorId,
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    meta: params.meta || {},
  });

  if (params.message) {
    broadcastEvent({
      type: `${params.entityType}:${params.action}`,
      workspaceId: params.workspaceId,
      actorId: params.actorId,
      entityId: params.entityId,
      message: params.message,
      payload: { id: act.id, meta: params.meta },
    });
  }

  return act;
}
