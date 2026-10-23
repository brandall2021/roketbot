export default function EstadoBadge({ estado }: { estado?: string | null }) {
  const e = (estado || "").trim().toUpperCase();
  const cls = e === "SI" ? "ok" : e === "NO" ? "warn" : e === "KO" ? "danger" : "";
  return <span className={`badge ${cls}`}>{e || "—"}</span>;
}
