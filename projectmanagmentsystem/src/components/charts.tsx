import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ReactNode } from 'react';

const axis = { fontSize: 12, fill: '#64748b' };
const tooltipStyle = { borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 };

function ChartEmpty({ children }: { children: ReactNode }) {
  return <div className="flex h-64 items-center justify-center text-center text-sm text-slate-400">{children}</div>;
}

export function BurndownChart({ points }: { points: { day: string; ideal: number; remaining: number | null }[] }) {
  if (!points.length) return <ChartEmpty>Start a sprint to see its burndown.</ChartEmpty>;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={points} margin={{ top: 10, right: 16, left: -12, bottom: 0 }}>
        <CartesianGrid stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="day" tick={axis} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
        <YAxis tick={axis} tickLine={false} axisLine={false} unit="h" />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v}h`} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line name="Ideal" type="linear" dataKey="ideal" stroke="#94a3b8" strokeDasharray="5 5" dot={false} strokeWidth={2} />
        <Line name="Remaining" type="stepAfter" dataKey="remaining" stroke="#2550eb" strokeWidth={2.5} dot={{ r: 2.5 }} connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function VelocityChart({ data }: { data: { name: string; committed: number; completed: number }[] }) {
  if (!data.length) return <ChartEmpty>Complete a sprint to start tracking velocity.</ChartEmpty>;
  const avg = Math.round(data.reduce((a, d) => a + d.completed, 0) / data.length);
  return (
    <div>
      <p className="mb-2 text-xs text-slate-500">
        Average velocity: <b className="text-slate-800">{avg}h</b> per sprint
      </p>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="name" tick={axis} tickLine={false} axisLine={false} />
          <YAxis tick={axis} tickLine={false} axisLine={false} unit="h" />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#f8fafc' }} formatter={(v: number) => `${v}h`} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar name="Committed" dataKey="committed" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
          <Bar name="Completed" dataKey="completed" fill="#2550eb" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function WorkloadChart({ data }: { data: { name: string; openHours: number; logged: number }[] }) {
  if (!data.length) return <ChartEmpty>No members yet.</ChartEmpty>;
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 46)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid stroke="#f1f5f9" horizontal={false} />
        <XAxis type="number" tick={axis} tickLine={false} axisLine={false} unit="h" />
        <YAxis type="category" dataKey="name" tick={axis} tickLine={false} axisLine={false} width={100} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#f8fafc' }} formatter={(v: number) => `${v}h`} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar name="Open estimate" dataKey="openHours" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={12} />
        <Bar name="Logged (period)" dataKey="logged" fill="#2550eb" radius={[0, 4, 4, 0]} barSize={12} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const STATUS_COLORS: Record<string, string> = { todo: '#94a3b8', in_progress: '#3b82f6', in_review: '#f59e0b', done: '#10b981' };

export function StatusPie({ data }: { data: { id: string; name: string; value: number }[] }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  if (!total) return <ChartEmpty>No tasks yet.</ChartEmpty>;
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative h-44 w-44 shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={2} stroke="none">
              {data.map((d) => <Cell key={d.id} fill={STATUS_COLORS[d.id]} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold">{total}</span>
          <span className="text-xs text-slate-500">tasks</span>
        </div>
      </div>
      <ul className="grid w-full min-w-0 grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        {data.map((d) => (
          <li key={d.id} className="flex min-w-0 items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: STATUS_COLORS[d.id] }} />
            <span className="min-w-0 flex-1 truncate whitespace-nowrap text-slate-600">{d.name}</span>
            <span className="shrink-0 font-medium tabular-nums">{d.value}</span>
            <span className="w-9 shrink-0 text-right text-xs tabular-nums text-slate-400">{Math.round((d.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
