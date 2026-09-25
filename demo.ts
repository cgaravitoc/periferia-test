// Verificacion sin modelo: recorre los 6 casos llamando directamente a las herramientas.
// Debe correr sin clave de ningun proveedor: bun run demo.ts
import { rmSync } from "node:fs";
import { join } from "node:path";
import { herramientas } from "./src/tools/oc";
import type { OrdenCompra, Paquete, ResultadoValidacion } from "./src/types";

const CASOS = ["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"];
const directory = process.cwd();
const ctx = { directory, sessionId: "demo" };

// Determinismo: out/ se limpia al inicio (RNF).
rmSync(join(directory, "out"), { recursive: true, force: true });

type Res<T> = { ok: true; data: T } | { ok: false; error: string };
const parse = <T>(s: string): Res<T> => JSON.parse(s) as Res<T>;

async function procesar(caso: string, confirmado: boolean): Promise<void> {
  const pRes = parse<Paquete>(await herramientas.leer_paquete.execute({ caso }, ctx));
  if (!pRes.ok) return console.log(`  ${caso}: ERROR leer -> ${pRes.error}`);
  const paquete = pRes.data;

  const vRes = parse<ResultadoValidacion>(await herramientas.validar.execute({ caso, paquete }, ctx));
  if (!vRes.ok) return console.log(`  ${caso}: ERROR validar -> ${vRes.error}`);
  const v = vRes.data;

  await herramientas.generar_evidencia.execute({ caso }, ctx);

  let payload: OrdenCompra | undefined;
  if (v.apta) {
    const cRes = parse<{ payload: OrdenCompra }>(await herramientas.construir_payload.execute({ caso, paquete, derivados: v.derivados }, ctx));
    if (cRes.ok) payload = cRes.data.payload;
  }

  const crearRes = parse<{ numero_oc: string; idempotente: boolean }>(
    await herramientas.crear.execute({ caso, payload, confirmado }, ctx),
  );

  const estado = crearRes.ok
    ? crearRes.data.idempotente
      ? `IDEMPOTENTE (OC ${crearRes.data.numero_oc})`
      : `CREADA (OC ${crearRes.data.numero_oc})`
    : v.apta
      ? `PENDIENTE CONFIRMACION`
      : `BLOQUEADA`;

  console.log(`  ${caso} [${paquete.solicitud.solicitud_id}] -> ${estado}${v.retroactiva ? " · retroactiva" : ""}`);
  if (v.bloqueos.length) console.log(`      bloqueos: ${v.bloqueos.join(" | ")}`);
  if (v.confirmaciones.length) console.log(`      confirmaciones: ${v.confirmaciones.join(" | ")}`);
}

console.log("=== Primera pasada (sin confirmar) ===");
for (const caso of CASOS) await procesar(caso, false);

console.log("\n=== Idempotencia: sol-001 de nuevo ===");
await procesar("sol-001", false);

console.log("\n=== Confirmacion explicita: sol-004 con confirmado=true ===");
await procesar("sol-004", true);

console.log("\nListo. Revisa out/control.csv, out/sap/ordenes.jsonl y out/<caso>/.");

