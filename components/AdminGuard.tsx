"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getMe } from "@/lib/client";

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    getMe()
      .then((me) => {
        if (!me) router.replace("/login");
        else if (me.rol !== "ADMIN") router.replace("/expedientes");
        else setAllowed(true);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  if (!allowed) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span className="muted">Cargando…</span>
      </div>
    );
  }

  return <>{children}</>;
}
