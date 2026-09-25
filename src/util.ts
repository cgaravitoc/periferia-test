// Utilidades compartidas por las herramientas: rutas, lectura de fixtures, parseo y maestros.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { CentroCosto, CondicionPago, IndicadorIva, Paquete, Proveedor, Solicitud } from "./types";

export interface Maestros {
  proveedores: Proveedor[];
  centros: CentroCosto[];
  iva: IndicadorIva[];
  condiciones: CondicionPago[];
}

export function rutaCaso(directory: string, caso: string): string {
  return join(directory, "fixtures", "reto-03", "solicitudes", caso);
}

export function rutaOut(directory: string, ...partes: string[]): string {
  return join(directory, "out", ...partes);
}

export function asegurarDir(ruta: string): void {
  if (!existsSync(ruta)) mkdirSync(ruta, { recursive: true });
}

function leerJson<T>(ruta: string): T {
  return JSON.parse(readFileSync(ruta, "utf8")) as T;
}

export function cargarMaestros(directory: string): Maestros {
  const base = join(directory, "fixtures", "reto-03", "maestros");
  return {
    proveedores: leerJson<Proveedor[]>(join(base, "proveedores.json")),
    centros: leerJson<CentroCosto[]>(join(base, "centros-costo.json")),
    iva: leerJson<IndicadorIva[]>(join(base, "indicadores-iva.json")),
    condiciones: leerJson<CondicionPago[]>(join(base, "condiciones-pago.json")),
  };
}

// Normaliza un NIT: descarta el digito de verificacion y deja solo digitos. "900.555.111-2" -> "900555111".
export function normalizarNit(nit: string): string {
  const sinDv = nit.split("-")[0] ?? nit;
  return sinDv.replace(/\D/g, "");
}

// Normaliza un nombre para comparar: minusculas, sin acentos, sin puntuacion.
export function normalizarNombre(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseMonto(s: string): number {
  return Number(s.replace(/\D/g, ""));
}

// Extrae referencia, proveedor, nit, total y moneda de una cotizacion en texto.
export function parseCotizacion(texto: string): {
  ref: string | null;
  proveedor: string;
  nit: string | null;
  total: number;
  moneda: string;
} {
  const ref = texto.match(/COTIZACI[\u00d3O]N\s+(\S+)/i)?.[1] ?? null;
  const proveedor = texto.match(/Proveedor:\s*(.+)/i)?.[1]?.trim() ?? "";
  const nitRaw = texto.match(/NIT:\s*([\d.\-]+)/i)?.[1] ?? null;
  const totalMatch = texto.match(/TOTAL[^\n:]*:\s*([A-Z]{3})\s*([\d.]+)/i);
  return {
    ref,
    proveedor,
    nit: nitRaw ? normalizarNit(nitRaw) : null,
    total: totalMatch?.[2] ? parseMonto(totalMatch[2]) : 0,
    moneda: totalMatch?.[1] ?? "COP",
  };
}

// Extrae numero, fecha y total de una factura en texto.
export function parseFactura(texto: string): { numero: string; fecha: string; total: number } {
  const numero = texto.match(/No\.\s*(\S+)/i)?.[1] ?? "";
  const fecha = texto.match(/Fecha de emisi[\u00f3o]n:\s*(\d{4}-\d{2}-\d{2})/i)?.[1] ?? "";
  const totalMatch = texto.match(/TOTAL[^\n:]*:\s*[A-Z]{3}\s*([\d.]+)/i);
  return { numero, fecha, total: totalMatch?.[1] ? parseMonto(totalMatch[1]) : 0 };
}

// Lee y normaliza el paquete de un caso. Un adjunto ausente queda como null.
export function leerPaquete(directory: string, caso: string): Paquete {
  const dir = rutaCaso(directory, caso);
  const correo = leerJson<{ id: string; de: string; asunto: string; fecha: string }>(join(dir, "correo.json"));
  const solicitud = leerJson<Solicitud>(join(dir, "solicitud.json"));

  let cotizacion: Paquete["cotizacion"] = null;
  if (existsSync(join(dir, "cotizacion.txt"))) {
    const texto = readFileSync(join(dir, "cotizacion.txt"), "utf8");
    const c = parseCotizacion(texto);
    cotizacion = { proveedor: c.proveedor, nit: c.nit, total: c.total, moneda: c.moneda, validez_hasta: null, texto };
  }

  let aprobacion: Paquete["aprobacion"] = null;
  if (existsSync(join(dir, "aprobacion.json"))) {
    const a = leerJson<{ de: string; fecha: string; cuerpo: string }>(join(dir, "aprobacion.json"));
    aprobacion = { de: a.de, fecha: a.fecha, aprobado: /aprobado/i.test(a.cuerpo), texto: a.cuerpo };
  }

  let factura: Paquete["factura"] = null;
  if (existsSync(join(dir, "factura.txt"))) {
    factura = parseFactura(readFileSync(join(dir, "factura.txt"), "utf8"));
  }

  return { correo: { id: correo.id, de: correo.de, asunto: correo.asunto, fecha: correo.fecha }, solicitud, cotizacion, aprobacion, factura };
}

export function sha256(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

// Solo la parte YYYY-MM-DD de una fecha ISO, para comparar por dia.
export function soloFecha(iso: string): string {
  return iso.slice(0, 10);
}

export function registrarLog(directory: string, entrada: Record<string, unknown>): void {
  asegurarDir(rutaOut(directory));
  appendFileSync(rutaOut(directory, "log.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...entrada }) + "\n");
}

export function registrarControl(
  directory: string,
  fila: { solicitud_id: string; resultado: string; numero_oc: string; retroactiva: boolean; bloqueos: string[]; confirmaciones: string[] },
): void {
  asegurarDir(rutaOut(directory));
  const ruta = rutaOut(directory, "control.csv");
  if (!existsSync(ruta)) {
    writeFileSync(ruta, "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts\n");
  }
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const linea = [
    fila.solicitud_id,
    fila.resultado,
    fila.numero_oc,
    String(fila.retroactiva),
    esc(fila.bloqueos.join("; ")),
    esc(fila.confirmaciones.join("; ")),
    new Date().toISOString(),
  ].join(",");
  appendFileSync(ruta, linea + "\n");
}
