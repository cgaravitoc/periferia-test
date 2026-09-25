// Herramientas del agente. Cada export se expone al modelo como oc_<export>.
// Contrato: execute devuelve string JSON { ok, data } | { ok:false, error }. NUNCA lanza.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { OrdenCompra, Paquete } from "../types";
import {
  asegurarDir,
  cargarMaestros,
  leerPaquete,
  parseCotizacion,
  registrarControl,
  registrarLog,
  rutaCaso,
  rutaOut,
  sha256,
} from "../util";
import { resolverCentro, resolverProveedor, validar } from "../validacion";
import { crearSapMock } from "../sap/mock";

export interface Ctx {
  directory: string;
  sessionId: string;
}

const ok = (data: unknown): string => JSON.stringify({ ok: true, data });
const fail = (error: string): string => JSON.stringify({ ok: false, error });

// Construye la OrdenCompra desde el paquete + maestros. Fuente unica usada por construir_payload y crear.
function construirOrden(paquete: Paquete, maestros: ReturnType<typeof cargarMaestros>, derivados: Record<string, string>): OrdenCompra | null {
  const s = paquete.solicitud;
  const proveedor = resolverProveedor(paquete, maestros);
  if (!proveedor) return null;
  const indicador_iva = s.indicador_iva ?? derivados.indicador_iva ?? proveedor.indicador_iva_default;
  const condiciones_pago = s.condiciones_pago ?? derivados.condiciones_pago ?? proveedor.condiciones_pago_default;
  const cotizacion_ref = paquete.cotizacion ? parseCotizacion(paquete.cotizacion.texto).ref : null;
  const evidencia = paquete.aprobacion ? sha256(paquete.aprobacion.texto) : "";
  const resultado = validar(paquete, maestros);
  return {
    referencia: { solicitud_id: s.solicitud_id, correo_id: paquete.correo.id, cotizacion_ref },
    sociedad: "1000",
    organizacion_compras: "1000",
    proveedor: { codigo_sap: proveedor.codigo_sap, nit: proveedor.nit, nombre: proveedor.nombre },
    moneda: s.moneda === "USD" ? "USD" : "COP",
    condiciones_pago,
    aprobador: { email: paquete.aprobacion?.de ?? "", fecha_aprobacion: paquete.aprobacion?.fecha ?? "", evidencia_sha256: evidencia },
    posiciones: [
      {
        numero: 10,
        descripcion: s.descripcion.slice(0, 40),
        cantidad: s.cantidad,
        unidad: "UN",
        precio_unitario: s.valor_unitario,
        centro_costo: s.centro_costo,
        subarea: s.subarea,
        indicador_iva,
      },
    ],
    excepciones: resultado.confirmaciones.map((c) => ({ codigo: c.split(":")[0] ?? "RC", detalle: c, confirmado_por: null })),
  };
}

// Esquema zod del payload de la OC (HU-3): el payload construido se valida contra el.
const ordenCompraSchema = z.object({
  referencia: z.object({ solicitud_id: z.string(), correo_id: z.string(), cotizacion_ref: z.string().nullable() }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({ codigo_sap: z.string(), nit: z.string(), nombre: z.string() }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string(),
  aprobador: z.object({ email: z.string(), fecha_aprobacion: z.string(), evidencia_sha256: z.string() }),
  posiciones: z.array(
    z.object({
      numero: z.number(),
      descripcion: z.string().max(40),
      cantidad: z.number(),
      unidad: z.enum(["UN", "H", "MES"]),
      precio_unitario: z.number(),
      centro_costo: z.string(),
      subarea: z.string(),
      indicador_iva: z.string(),
    }),
  ),
  excepciones: z.array(z.object({ codigo: z.string(), detalle: z.string(), confirmado_por: z.string().nullable() })),
});

// --- oc_leer_paquete ---
export const leer_paquete = {
  description:
    "Lee y normaliza el paquete de un caso (correo, solicitud, cotizacion, aprobacion y factura si existe).",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/"),
  },
  async execute(args: { caso: string }, ctx: Ctx): Promise<string> {
    try {
      if (!existsSync(rutaCaso(ctx.directory, args.caso))) return fail(`caso '${args.caso}' no existe.`);
      const paquete = leerPaquete(ctx.directory, args.caso);
      registrarLog(ctx.directory, { herramienta: "oc_leer_paquete", caso: args.caso, ok: true, resumen: paquete.solicitud.solicitud_id });
      return ok(paquete);
    } catch (e) {
      return fail(`no se pudo leer el paquete: ${(e as Error).message}`);
    }
  },
};

// --- oc_validar ---
export const validar_tool = {
  description:
    "Aplica los controles RC1-RC10 al paquete y devuelve bloqueos, confirmaciones, derivados y si es retroactiva.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso"),
    paquete: z.unknown().describe("Paquete normalizado devuelto por oc_leer_paquete"),
  },
  async execute(args: { caso: string; paquete: unknown }, ctx: Ctx): Promise<string> {
    try {
      const paquete = (args.paquete as Paquete) ?? leerPaquete(ctx.directory, args.caso);
      const resultado = validar(paquete, cargarMaestros(ctx.directory));
      registrarLog(ctx.directory, { herramienta: "oc_validar", caso: args.caso, ok: true, resumen: `apta=${resultado.apta}` });
      return ok(resultado);
    } catch (e) {
      return fail(`no se pudo validar: ${(e as Error).message}`);
    }
  },
};

// --- oc_construir_payload ---
export const construir_payload = {
  description:
    "Construye el payload de la OrdenCompra a partir del paquete y los derivados, con trazabilidad de cada valor.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso"),
    paquete: z.unknown().describe("Paquete normalizado"),
    derivados: z.record(z.string()).optional().describe("Valores derivados de maestros (ej. indicador_iva, condiciones_pago)"),
  },
  async execute(args: { caso: string; paquete: unknown; derivados?: Record<string, string> }, ctx: Ctx): Promise<string> {
    try {
      const paquete = (args.paquete as Paquete) ?? leerPaquete(ctx.directory, args.caso);
      const maestros = cargarMaestros(ctx.directory);
      const s = paquete.solicitud;
      const payload = construirOrden(paquete, maestros, args.derivados ?? {});
      if (!payload) return fail("no se puede construir el payload: proveedor no resuelto (bloqueo RC1).");

      const validado = ordenCompraSchema.safeParse(payload);
      if (!validado.success) return fail(`payload invalido: ${validado.error.issues.map((i) => i.message).join("; ")}`);

      const centro = resolverCentro(paquete, maestros);
      const trazabilidad = {
        "proveedor.codigo_sap": "maestro.proveedores",
        "proveedor.nit": "maestro.proveedores",
        condiciones_pago: s.condiciones_pago ? "solicitud" : "derivado",
        "posiciones[0].indicador_iva": s.indicador_iva ? "solicitud" : "derivado",
        "posiciones[0].precio_unitario": "solicitud",
        "posiciones[0].centro_costo": "solicitud",
        "aprobador.email": "aprobacion",
        "referencia.cotizacion_ref": paquete.cotizacion ? "cotizacion" : "ausente",
        centro_costo_nombre: centro?.nombre ?? "desconocido",
      };
      const dir = rutaOut(ctx.directory, args.caso);
      asegurarDir(dir);
      await Bun.write(join(dir, "trazabilidad.json"), JSON.stringify(trazabilidad, null, 2));

      registrarLog(ctx.directory, { herramienta: "oc_construir_payload", caso: args.caso, ok: true, resumen: s.solicitud_id });
      return ok({ payload, trazabilidad_ruta: `out/${args.caso}/trazabilidad.json` });
    } catch (e) {
      return fail(`no se pudo construir el payload: ${(e as Error).message}`);
    }
  },
};

// --- oc_generar_evidencia ---
export const generar_evidencia = {
  description: "Genera la evidencia de aprobacion (aprobacion.txt con sha256) del caso.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso"),
  },
  async execute(args: { caso: string }, ctx: Ctx): Promise<string> {
    try {
      const ruta = join(rutaCaso(ctx.directory, args.caso), "aprobacion.json");
      if (!existsSync(ruta)) return fail("no hay aprobacion para generar evidencia.");
      const a = JSON.parse(readFileSync(ruta, "utf8")) as { de: string; para: string; fecha: string; asunto: string; cuerpo: string };
      const contenido = `De: ${a.de}\nPara: ${a.para}\nFecha: ${a.fecha}\nAsunto: ${a.asunto}\n\n${a.cuerpo}\n`;
      const hash = sha256(contenido);
      const dir = rutaOut(ctx.directory, args.caso);
      asegurarDir(dir);
      await Bun.write(join(dir, "aprobacion.txt"), contenido);
      registrarLog(ctx.directory, { herramienta: "oc_generar_evidencia", caso: args.caso, ok: true, resumen: hash.slice(0, 12) });
      return ok({ ruta: `out/${args.caso}/aprobacion.txt`, sha256: hash });
    } catch (e) {
      return fail(`no se pudo generar la evidencia: ${(e as Error).message}`);
    }
  },
};

// --- oc_crear ---
export const crear = {
  description:
    "Crea la OC en el SAP simulado. Solo procede si apta=true y (sin confirmaciones o confirmado=true). Idempotente por solicitud_id.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso"),
    payload: z.unknown().describe("OrdenCompra construida por oc_construir_payload"),
    confirmado: z.boolean().optional().describe("true si el usuario confirmo las excepciones"),
  },
  async execute(args: { caso: string; payload: unknown; confirmado?: boolean }, ctx: Ctx): Promise<string> {
    try {
      const paquete = leerPaquete(ctx.directory, args.caso);
      const maestros = cargarMaestros(ctx.directory);
      const v = validar(paquete, maestros);
      const solicitud_id = paquete.solicitud.solicitud_id;

      // Bloqueos: nunca se crea.
      if (!v.apta) {
        registrarControl(ctx.directory, { solicitud_id, resultado: "bloqueada", numero_oc: "", retroactiva: v.retroactiva, bloqueos: v.bloqueos, confirmaciones: v.confirmaciones });
        registrarLog(ctx.directory, { herramienta: "oc_crear", caso: args.caso, ok: false, resumen: "bloqueada" });
        return fail(`bloqueada: ${v.bloqueos.join(" | ")}`);
      }

      // Confirmaciones pendientes: requiere confirmado=true.
      if (v.confirmaciones.length > 0 && args.confirmado !== true) {
        registrarControl(ctx.directory, { solicitud_id, resultado: "pendiente", numero_oc: "", retroactiva: v.retroactiva, bloqueos: [], confirmaciones: v.confirmaciones });
        registrarLog(ctx.directory, { herramienta: "oc_crear", caso: args.caso, ok: false, resumen: "pendiente confirmacion" });
        return fail(`requiere confirmacion: ${v.confirmaciones.join(" | ")}`);
      }

      const sap = crearSapMock(ctx.directory);
      const existente = await sap.buscarOrdenPorReferencia(solicitud_id);
      if (existente) {
        registrarControl(ctx.directory, { solicitud_id, resultado: "idempotente", numero_oc: existente.numero_oc, retroactiva: v.retroactiva, bloqueos: [], confirmaciones: v.confirmaciones });
        registrarLog(ctx.directory, { herramienta: "oc_crear", caso: args.caso, ok: true, resumen: `idempotente ${existente.numero_oc}` });
        return ok({ numero_oc: existente.numero_oc, fecha: new Date().toISOString(), idempotente: true });
      }

      // Se reconstruye la orden desde el caso (no se confia en el payload del modelo).
      const payload = construirOrden(paquete, maestros, v.derivados);
      if (!payload) return fail("no se pudo construir la orden para crear (proveedor no resuelto).");
      const creada = await sap.crearOrden(payload);
      registrarControl(ctx.directory, { solicitud_id, resultado: "creada", numero_oc: creada.numero_oc, retroactiva: v.retroactiva, bloqueos: [], confirmaciones: v.confirmaciones });
      registrarLog(ctx.directory, { herramienta: "oc_crear", caso: args.caso, ok: true, resumen: `creada ${creada.numero_oc}` });
      return ok({ numero_oc: creada.numero_oc, fecha: creada.fecha, idempotente: false });
    } catch (e) {
      return fail(`no se pudo crear la OC: ${(e as Error).message}`);
    }
  },
};

// Registro de herramientas. El nombre visible para el modelo es oc_<clave>.
export const herramientas = {
  leer_paquete,
  validar: validar_tool,
  construir_payload,
  generar_evidencia,
  crear,
};
