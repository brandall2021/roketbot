#!/usr/bin/env node
/**
 * CLI del worker (antes `cli.py` del bot).
 *
 *     npx tsx worker/cli.ts run [--limit 50] [--token ...] [--notify]
 *     npx tsx worker/cli.ts worker [--interval 3600] [--limit 50] [--notify]
 *     npx tsx worker/cli.ts retry-ko [--corrida 123]
 *     npx tsx worker/cli.ts stats
 *
 * Los comandos de esquema y de usuarios viven aparte: `npm run migrate` y
 * `npm run seed`. La importación de padrones por CSV se hace desde el panel, que
 * es donde está el mapeo de columnas y el registro de la carga.
 *
 * IMPORTANTE: los imports son relativos (`../lib/...`), nunca con el alias `@/`.
 * Este proceso corre con Node a secas, sin el bundler de Next, y el alias sólo
 * lo resuelve Next.
 */

import { cerrarPool } from "../lib/db";
import { resumenDeSistema } from "../lib/corridas";
import { correrUna, reintentarKo, workerResidente } from "./corrida";

type Args = {
  comando: string;
  limites: number | null;
  token: string | null;
  notificar: boolean;
  intervalo: number | null;
  corrida: number | null;
};

function parsear(argv: string[]): Args {
  const [comando = "stats", ...restos] = argv;
  const args: Args = {
    comando,
    limites: null,
    token: null,
    notificar: false,
    intervalo: null,
    corrida: null,
  };

  for (let i = 0; i < restos.length; i++) {
    const bander = restos[i];
    const valor = restos[i + 1];
    switch (bander) {
      case "--limit":
      case "-n":
        args.limites = Number(valor);
        i++;
        break;
      case "--token":
        args.token = valor ?? "";
        i++;
        break;
      case "--notify":
        args.notificar = true;
        break;
      case "--interval":
        args.intervalo = Number(valor);
        i++;
        break;
      case "--corrida":
        args.corrida = Number(valor);
        i++;
        break;
      default:
        throw new Error(`Bander desconocido: ${bander}`);
    }
  }

  if (args.limites !== null && (!Number.isFinite(args.limites) || args.limites <= 0)) {
    throw new Error("--limit tiene que ser un entero positivo");
  }
  if (args.intervalo !== null && (!Number.isFinite(args.intervalo) || args.intervalo < 10)) {
    throw new Error("--interval tiene que ser de al menos 10 segundos");
  }
  return args;
}

async function stats(): Promise<void> {
  const r = await resumenDeSistema();
  console.log(`Expedientes:  ${r.expedientes}`);
  console.log(`Movimientos:  ${r.movimientos}`);
  console.log(`Corridas:     ${r.corridas}`);
  console.log(`Pendientes:   ${r.pendientes} (nunca consultados)`);
  console.log(`Resultados:   ${JSON.stringify(r.porResultado)}`);
  console.log(
    r.ultimaCorrida
      ? `Última corrida #${r.ultimaCorrida.id} ${r.ultimaCorrida.estado}: ` +
          `${r.ultimaCorrida.si} SI / ${r.ultimaCorrida.no} NO / ${r.ultimaCorrida.ko} KO ` +
          `de ${r.ultimaCorrida.total}`
      : "Todavía no hay corridas."
  );
}

const AYUDA = `uso: tsx worker/cli.ts <comando>

  run [--limit N] [--token T] [--notify]   una corrida de consulta al PJud
  worker [--interval S] [--limit N]        corridas en bucle
  retry-ko [--corrida ID]                  reprocesa sólo los KO
  stats                                    resumen de la base

El token se puede pasar por CAPTCHA_TOKEN; no lo escribas en un script commiteado.`;

async function main(argv: string[]): Promise<number> {
  const args = parsear(argv);

  switch (args.comando) {
    case "run": {
      const id = await correrUna({
        token: args.token,
        limite: args.limites ?? undefined,
        notificar: args.notificar,
      });
      console.log(`Corrida ${id} finalizada.`);
      return 0;
    }
    case "worker": {
      if (args.intervalo !== null) process.env.WORKER_INTERVALO_S = String(args.intervalo);
      // El bucle no termina nunca: lo corta el supervisor (docker) con SIGTERM.
      await workerResidente();
      return 0;
    }
    case "retry-ko": {
      const id = await reintentarKo(args.corrida ?? undefined, { token: args.token });
      console.log(id ? `Reintento ${id} finalizado.` : "Nada para reintentar.");
      return 0;
    }
    case "stats": {
      await stats();
      return 0;
    }
    case "--help":
    case "-h":
    case "help": {
      console.log(AYUDA);
      return 0;
    }
    default:
      console.error(AYUDA);
      throw new Error(`Comando desconocido: ${args.comando}`);
  }
}

main(process.argv.slice(2))
  .then(async (code) => {
    await cerrarPool();
    process.exit(code);
  })
  .catch(async (e) => {
    console.error(`[cli] ${e instanceof Error ? e.message : String(e)}`);
    await cerrarPool().catch(() => undefined);
    process.exit(1);
  });
