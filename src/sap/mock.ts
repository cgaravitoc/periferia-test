// SAP simulado sobre archivos en out/sap/. Implementa SapAdapter.
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { SapAdapter } from "./adapter";
import type { OrdenCompra, Proveedor } from "../types";
import { asegurarDir, normalizarNit, rutaOut } from "../util";

const NUMERO_INICIAL = 4500000001;

interface RegistroOrden {
  numero_oc: string;
  solicitud_id: string;
  fecha: string;
  orden: OrdenCompra;
}

function leerOrdenes(directory: string): RegistroOrden[] {
  const ruta = rutaOut(directory, "sap", "ordenes.jsonl");
  if (!existsSync(ruta)) return [];
  return readFileSync(ruta, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as RegistroOrden);
}

export function crearSapMock(directory: string): SapAdapter {
  return {
    async consultarProveedor(nit: string) {
      const base = join(directory, "fixtures", "reto-03", "maestros", "proveedores.json");
      const proveedores = JSON.parse(readFileSync(base, "utf8")) as Proveedor[];
      const p = proveedores.find((x) => normalizarNit(x.nit) === normalizarNit(nit));
      return p ? { codigo_sap: p.codigo_sap, activo: p.activo } : null;
    },

    async crearOrden(orden: OrdenCompra) {
      const existentes = leerOrdenes(directory);
      const numero_oc = String(NUMERO_INICIAL + existentes.length);
      const fecha = new Date().toISOString();
      asegurarDir(rutaOut(directory, "sap"));
      const registro: RegistroOrden = { numero_oc, solicitud_id: orden.referencia.solicitud_id, fecha, orden };
      appendFileSync(rutaOut(directory, "sap", "ordenes.jsonl"), JSON.stringify(registro) + "\n");
      return { numero_oc, fecha };
    },

    async buscarOrdenPorReferencia(solicitud_id: string) {
      const existente = leerOrdenes(directory).find((r) => r.solicitud_id === solicitud_id);
      return existente ? { numero_oc: existente.numero_oc } : null;
    },
  };
}
