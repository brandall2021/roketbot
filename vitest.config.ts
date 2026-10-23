import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Los tests corren en Node (`environment: "node"`) porque toda la capa que se prueba
 * es de servidor: rutas de Next, SQL y parseo de CSV. No hay jsdom ni React acá.
 *
 * `globals: false` obliga a importar `describe/it/expect/vi` explícitamente, que es
 * además lo que hace `npm run typecheck` (tsc) feliz: sin globales, los tipos de
 * vitest no tienen que entrar en el `tsconfig.json` de la app.
 *
 * Ningún test toca una base de datos real: lo que habla con Postgres se ve tapado
 * con `vi.mock("@/lib/db")`.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
  },
});
