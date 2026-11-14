import { useEffect, useMemo, useRef, useState } from 'react';
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import clsx from 'clsx';
import { Plus } from 'lucide-react';
import { useApp, run } from '@/store/app';
import { tasksApi } from '@/lib/api';
import { STATUS_DOT } from '@/lib/format';
import { STATUSES, type Task, type TaskStatus } from '@/lib/types';
import TaskCard from './TaskCard';
import { useOpenTask } from './hooks';

type Columns = Record<TaskStatus, string[]>;

const toColumns = (tasks: Task[]): Columns => {
  const c: Columns = { todo: [], in_progress: [], in_review: [], done: [] };
  [...tasks].sort((a, b) => a.order - b.order).forEach((t) => c[t.status].push(t.id));
  return c;
};

function SortableCard({ task, meta, disabled }: { task: Task; meta: CardMeta; disabled: boolean }) {
  const openTask = useOpenTask();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled });
  const [flash, setFlash] = useState(false);
  const prev = useRef(task.updatedAt);
  useEffect(() => {
    if (prev.current !== task.updatedAt) {
      prev.current = task.updatedAt;
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1200);
      return () => clearTimeout(t);
    }
  }, [task.updatedAt]);
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx(isDragging && 'opacity-40', flash && 'flash rounded-md')}
      {...attributes}
      {...listeners}
    >
      <TaskCard task={task} subtasks={meta.subtasks[task.id]} comments={meta.comments[task.id]} onClick={() => openTask(task.id)} />
    </div>
  );
}

function Column({ status, ids, byId, meta, canEdit, onAdd }: { status: TaskStatus; ids: string[]; byId: Map<string, Task>; meta: CardMeta; canEdit: boolean; onAdd: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const label = STATUSES.find((s) => s.id === status)!.label;
  const hours = ids.reduce((a, id) => a + (byId.get(id)?.estimateHours ?? 0), 0);
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-lg bg-slate-100/80 sm:w-auto sm:min-w-0 sm:flex-1" data-testid={`column-${status}`}>
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className={clsx('h-2 w-2 rounded-full', STATUS_DOT[status])} />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</h3>
        <span className="rounded-full bg-white px-1.5 text-xs font-medium text-slate-500">{ids.length}</span>
        <span className="flex-1" />
        {hours > 0 && <span className="text-xs text-slate-400">{hours}h</span>}
        {canEdit && (
          <button onClick={onAdd} className="rounded p-0.5 text-slate-400 hover:bg-white hover:text-slate-700" aria-label={`Add task to ${label}`}>
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>
      <SortableContext id={status} items={ids} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className={clsx('flex min-h-[120px] flex-1 flex-col gap-2 px-2 pb-3 transition', isOver && 'rounded-b-lg bg-brand-50')}>
          {ids.map((id) => {
            const t = byId.get(id);
            return t ? <SortableCard key={id} task={t} meta={meta} disabled={!canEdit} /> : null;
          })}
          {!ids.length && <p className="py-6 text-center text-xs text-slate-400">{canEdit ? 'Drop tasks here' : 'No tasks'}</p>}
        </div>
      </SortableContext>
    </div>
  );
}

export interface CardMeta {
  subtasks: Record<string, { done: number; total: number }>;
  comments: Record<string, number>;
}

export default function Board({ tasks, meta, canEdit, projectId, sprintId }: { tasks: Task[]; meta: CardMeta; canEdit: boolean; projectId: string; sprintId?: string | null }) {
  const fromData = useMemo(() => toColumns(tasks), [tasks]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const [cols, setCols] = useState<Columns>(fromData);
  const [activeId, setActiveId] = useState<string | null>(null);
  const openCreate = useApp((s) => s.openCreateTask);
  const startCol = useRef<TaskStatus | null>(null);

  // Accept server (or other-tab) updates whenever we're not mid-drag.
  useEffect(() => {
    if (!activeId) setCols(fromData);
  }, [fromData, activeId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findCol = (id: string | null | undefined): TaskStatus | null => {
    if (!id) return null;
    if (id in cols) return id as TaskStatus;
    return (Object.keys(cols) as TaskStatus[]).find((k) => cols[k].includes(id)) ?? null;
  };

  const onStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
    startCol.current = findCol(String(e.active.id));
  };

  const onOver = ({ active, over }: DragOverEvent) => {
    const from = findCol(String(active.id));
    const to = findCol(over ? String(over.id) : null);
    if (!from || !to || from === to) return;
    setCols((prev) => {
      const fromItems = prev[from].filter((x) => x !== active.id);
      const toItems = [...prev[to]];
      const overIdx = toItems.indexOf(String(over!.id));
      toItems.splice(overIdx >= 0 ? overIdx : toItems.length, 0, String(active.id));
      return { ...prev, [from]: fromItems, [to]: toItems };
    });
  };

  const onEnd = ({ active, over }: DragEndEvent) => {
    const id = String(active.id);
    setActiveId(null);
    const to = findCol(over ? String(over.id) : null);
    if (!to) return setCols(fromData);
    let list = cols[to];
    const oldIdx = list.indexOf(id);
    const overIdx = over ? list.indexOf(String(over.id)) : -1;
    if (oldIdx >= 0 && overIdx >= 0 && oldIdx !== overIdx) list = arrayMove(list, oldIdx, overIdx);
    const next = { ...cols, [to]: list };
    setCols(next);
    const idx = list.indexOf(id);
    const t = byId.get(id);
    if (!t) return;
    const unchanged = t.status === to && startCol.current === to && fromData[to].indexOf(id) === idx;
    if (unchanged) return;
    run(() => tasksApi.move(id, to, list[idx - 1] ?? null, list[idx + 1] ?? null)).then((ok) => !ok && setCols(fromData));
  };

  const active = activeId ? byId.get(activeId) : null;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onStart} onDragOver={onOver} onDragEnd={onEnd} onDragCancel={() => { setActiveId(null); setCols(fromData); }}>
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 scrollbar-thin sm:mx-0 sm:px-0">
        {STATUSES.map((s) => (
          <Column key={s.id} status={s.id} ids={cols[s.id]} byId={byId} meta={meta} canEdit={canEdit} onAdd={() => openCreate({ projectId, status: s.id, sprintId: sprintId ?? null })} />
        ))}
      </div>
      <DragOverlay>{active ? <TaskCard task={active} subtasks={meta.subtasks[active.id]} comments={meta.comments[active.id]} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}
