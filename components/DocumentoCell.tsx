export function docHref(d: string): string {
  const t = d.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export default function DocumentoCell({ doc }: { doc?: string | null }) {
  const d = (doc || "").trim();
  if (!d) return <span className="badge soft">Sin documento</span>;
  return (
    <a className="doc-link" href={docHref(d)} target="_blank" rel="noreferrer">
      Ver documento
    </a>
  );
}
