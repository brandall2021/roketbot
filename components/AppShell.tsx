"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LayoutDashboard, FolderOpen, Upload, FileArchive, Building2, MapPin, Table2, Users, RotateCcw, Activity } from "lucide-react";
import { getMe } from "@/lib/client";
import type { Kpis } from "@/components/KpiCards";

type User = { nombre: string; username: string; rol: string };

const NAV = [
  { href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/expedientes", label: "Expedientes", Icon: FolderOpen },
  { href: "/caratula", label: "Carátula", Icon: Table2 },
  { href: "/expedientes/importar", label: "Importar CSV", Icon: Upload },
  { href: "/expedientes/actualizar", label: "Actualizar CSV", Icon: RotateCcw },
  { href: "/expedientes/archivos", label: "Archivos subidos", Icon: FileArchive },
  { href: "/centros", label: "Centros", Icon: Building2 },
  { href: "/provincias", label: "Provincias", Icon: MapPin },
];

type NavItem = (typeof NAV)[number];

// Seguimiento de corridas y usuarios: sólo ADMIN. La barrera de verdad está en cada
// página (`sesionAdmin()` de lib/sesion.ts); este recorte es para que el menú no
// ofrezca una entrada que después redirige.
const NAV_ADMIN: NavItem[] = [
  { href: "/corridas", label: "Corridas", Icon: Activity },
  { href: "/usuarios", label: "Usuarios", Icon: Users },
];

function fmtFecha(s: string | null | undefined) {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    getMe().then(setUser).catch(() => setUser(null));
    fetch("/api/expedientes/kpis", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setKpis)
      .catch(() => setKpis(null));
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  const nav: NavItem[] = user?.rol === "ADMIN" ? [...NAV, ...NAV_ADMIN] : NAV;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <button className="btn btn-ghost btn-sm hamburger" onClick={() => setMenu(true)} aria-label="Abrir menú">
            ☰
          </button>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <a
              href="/dashboard"
              style={{ color: "var(--text)", textDecoration: "none", display: "flex", alignItems: "center", gap: 10 }}
            >
              <img
                src="/logo.png"
                alt="Logo"
                className="topbar-logo"
                width={96}
                height={35}
                style={{ objectFit: "contain" }}
              />
              <span>Expedientes Jurídicos</span>
            </a>
          </h1>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <span className="user">
            {user ? `${user.nombre} (${user.username})` : ""}
            {user && <span className="badge" style={{ marginLeft: 8 }}>{user.rol}</span>}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={logout}>
            Salir
          </button>
        </div>
      </header>

      <div className="shell-body">
        <aside className="sidebar">
          <nav className="side-nav">
            {nav.map((n) => (
              <a key={n.href} href={n.href} className={pathname === n.href ? "active" : ""}>
                <n.Icon size={16} strokeWidth={2} />
                <span>{n.label}</span>
              </a>
            ))}
          </nav>
          {user && (
            <div className="muted" style={{ fontSize: 12 }}>
              Conectado como <b>{user.username}</b>
            </div>
          )}
        </aside>
        <main className="content">{children}</main>
      </div>

      {menu && (
        <div className="drawer-overlay" onClick={() => setMenu(false)}>
          <div className="drawer-left" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <b>Menú</b>
              <button className="btn btn-ghost btn-sm" onClick={() => setMenu(false)} aria-label="Cerrar menú">
                ✕
              </button>
            </div>
            <nav className="side-nav">
              {nav.map((n) => (
                <a
                  key={n.href}
                  href={n.href}
                  className={pathname === n.href ? "active" : ""}
                  onClick={() => setMenu(false)}
                >
                  <n.Icon size={16} strokeWidth={2} />
                  <span>{n.label}</span>
                </a>
              ))}
            </nav>
          </div>
        </div>
      )}

      <div className="status-strip">
        <span className="dot ok" /> Sistema activo
        <span>·</span>
        <span>{kpis ? `${kpis.total.toLocaleString()} expedientes` : "cargando…"}</span>
        <span>·</span>
        <span>Última actualización {fmtFecha(kpis?.ultimaActualizacion)}</span>
        {user && (
          <>
            <span>·</span>
            <span>
              Usuario <b>{user.username}</b>
            </span>
          </>
        )}
      </div>

      <footer className="footer">
        © {new Date().getFullYear()} <a href="https://softgroup.com.ar" target="_blank" rel="noreferrer">softgroup.com.ar</a>
      </footer>
    </div>
  );
}
