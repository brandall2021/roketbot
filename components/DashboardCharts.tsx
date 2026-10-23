"use client";

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { useRouter } from "next/navigation";
import { buildEstadoChartData } from "@/lib/dashboard-data.js";

const C = {
  azul: "#3b82f6",
  azulClaro: "#60a5fa",
  warn: "#f59e0b",
};

const tooltipStyle = {
  backgroundColor: "#1c2538",
  border: "1px solid #2a3550",
  borderRadius: 8,
  color: "#e6e9f0",
  fontSize: 12.5,
} as const;

const axisStyle = { fill: "#93a0bd", fontSize: 11.5 } as const;

type Datum = { name: string; value: number; color?: string };

function ChartCard({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="chart-card">
      <div className="chart-card-head">
        <h4>{title}</h4>
        {sub && <span>{sub}</span>}
      </div>
      {children}
    </div>
  );
}

function LegendList({ data, onSelect }: { data: Datum[]; onSelect?: (d: Datum) => void }) {
  return (
    <div className="chart-legend">
      {data.map((d) => (
        <button
          type="button"
          className="legend-item"
          key={d.name}
          onClick={() => onSelect?.(d)}
          style={{ width: "100%", textAlign: "left", background: "transparent", border: 0, padding: 0 }}
        >
          <span className="legend-dot" style={{ background: d.color || C.azul }} />
          <span className="legend-name">{d.name}</span>
          <span className="legend-value">{d.value.toLocaleString()}</span>
        </button>
      ))}
    </div>
  );
}

export default function DashboardCharts({
  estados,
  documentos,
  porMes,
  centros,
  unidades,
  estadoResumen,
  alertas,
}: {
  estados: Datum[];
  documentos: Datum[];
  porMes: { mes: string; total: number }[];
  centros: Datum[];
  unidades: Datum[];
  estadoResumen: { activo: number; inactivo: number };
  alertas: Datum[];
}) {
  const router = useRouter();

  function irAExpedientes(params: Record<string, string>) {
    router.push(`/expedientes?${new URLSearchParams(params).toString()}`);
  }

  const estadosData = buildEstadoChartData(estados) as (Datum & { color: string })[];
  const estadoActivoInactivo = [
    { name: "Activo", value: estadoResumen.activo, color: "#22c55e" },
    { name: "Inactivo", value: estadoResumen.inactivo, color: "#f59e0b" },
  ];
  const docData = documentos.map((d, i) => ({ ...d, color: i === 0 ? C.azul : C.azulClaro }));
  const centroData = centros.map((d) => ({ ...d, color: C.azul }));
  const unidadData = unidades.map((d) => ({ ...d, color: C.azulClaro }));
  const alertData = alertas.map((a) => ({ ...a, color: a.color || C.warn }));

  const mesData = porMes.map((m) => ({
    ...m,
    label: `${m.mes.slice(5)}/${m.mes.slice(2, 4)}`,
  }));

  return (
    <div className="charts">
      <div className="charts-grid">
        <ChartCard title="Estado de expediente" sub="Activo / Inactivo">
          <div className="donut-wrap">
            <ResponsiveContainer width="100%" height={210}>
              <PieChart>
                <Pie
                  data={estadoActivoInactivo}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="64%"
                  outerRadius="90%"
                  paddingAngle={2}
                  stroke="none"
                >
                  {estadoActivoInactivo.map((e) => (
                    <Cell
                      key={e.name}
                      fill={e.color}
                      cursor="pointer"
                      onClick={() => irAExpedientes({ estado: e.name.toUpperCase() })}
                    />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-center">
              <b>{(estadoResumen.activo + estadoResumen.inactivo).toLocaleString()}</b>
              <span>expedientes</span>
            </div>
          </div>
          <LegendList data={estadoActivoInactivo} onSelect={(d) => irAExpedientes({ estado: d.name.toUpperCase() })} />
        </ChartCard>

        <ChartCard title="Documentos">
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={docData} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3550" vertical={false} />
              <XAxis dataKey="name" tick={axisStyle} axisLine={false} tickLine={false} interval={0} />
              <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={60}>
                {docData.map((d) => (
                  <Cell key={d.name} fill={d.color} cursor="pointer" onClick={() => irAExpedientes({ documento: d.name })} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <LegendList data={docData} onSelect={(d) => irAExpedientes({ documento: d.name })} />
        </ChartCard>

        <ChartCard title="Alertas">
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={alertData} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3550" horizontal={false} />
              <XAxis type="number" tick={axisStyle} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={axisStyle} axisLine={false} tickLine={false} width={128} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={18}>
                {alertData.map((a) => (
                  <Cell key={a.name} fill={a.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="charts-grid" style={{ marginTop: 16 }}>
        <ChartCard title="Estados textuales" sub="Top estados">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={estadosData} layout="vertical" margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3550" horizontal={false} />
              <XAxis type="number" tick={axisStyle} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={axisStyle} axisLine={false} tickLine={false} width={128} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={18}>
                {estadosData.map((e) => (
                  <Cell key={e.name} fill={e.color} cursor="pointer" onClick={() => irAExpedientes({ estado: e.name })} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <LegendList data={estadosData} onSelect={(d) => irAExpedientes({ estado: d.name })} />
        </ChartCard>

        <ChartCard title="Por centro" sub="Top 6 centros">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={centroData} layout="vertical" margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3550" horizontal={false} />
              <XAxis type="number" tick={axisStyle} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={axisStyle} axisLine={false} tickLine={false} width={128} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={18}>
                {centroData.map((e) => (
                  <Cell key={e.name} fill={e.color} cursor="pointer" onClick={() => irAExpedientes({ centro: e.name })} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <LegendList data={centroData} onSelect={(d) => irAExpedientes({ centro: d.name })} />
        </ChartCard>

        <ChartCard title="Por unidad" sub="Top 6 unidades">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={unidadData} layout="vertical" margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3550" horizontal={false} />
              <XAxis type="number" tick={axisStyle} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={axisStyle} axisLine={false} tickLine={false} width={128} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={18}>
                {unidadData.map((e) => (
                  <Cell key={e.name} fill={e.color} cursor="pointer" onClick={() => irAExpedientes({ unidad: e.name })} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <LegendList data={unidadData} onSelect={(d) => irAExpedientes({ unidad: d.name })} />
        </ChartCard>
      </div>

      <div className="chart-wide">
        <ChartCard title="Expedientes actualizados por mes" sub="Últimos 12 meses">
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={mesData} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3550" vertical={false} />
              <XAxis dataKey="label" tick={axisStyle} axisLine={false} tickLine={false} />
              <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line
                type="monotone"
                dataKey="total"
                name="Actualizados"
                stroke={C.azul}
                strokeWidth={2.5}
                dot={{ r: 3, fill: C.azul, stroke: "#0f1420", strokeWidth: 1.5 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}
