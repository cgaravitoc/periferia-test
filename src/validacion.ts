// Controles de negocio RC1-RC10. Funcion pura: recibe paquete + maestros, devuelve el resultado.
import type { CentroCosto, Paquete, Proveedor, ResultadoValidacion } from "./types";
import type { Maestros } from "./util";
import { normalizarNit, normalizarNombre, soloFecha } from "./util";

export function resolverProveedor(paquete: Paquete, maestros: Maestros): Proveedor | null {
  const nit = paquete.solicitud.proveedor_nit ? normalizarNit(paquete.solicitud.proveedor_nit) : null;
  if (nit) {
    const porNit = maestros.proveedores.find((p) => normalizarNit(p.nit) === nit);
    if (porNit) return porNit;
  }
  const nombre = normalizarNombre(paquete.solicitud.proveedor_nombre);
  return maestros.proveedores.find((p) => normalizarNombre(p.nombre) === nombre) ?? null;
}

export function resolverCentro(paquete: Paquete, maestros: Maestros): CentroCosto | null {
  return maestros.centros.find((c) => c.centro_costo === paquete.solicitud.centro_costo) ?? null;
}

export function validar(paquete: Paquete, maestros: Maestros): ResultadoValidacion {
  const bloqueos: string[] = [];
  const confirmaciones: string[] = [];
  const derivados: Record<string, string> = {};
  let retroactiva = false;

  const s = paquete.solicitud;
  const proveedor = resolverProveedor(paquete, maestros);
  const centro = resolverCentro(paquete, maestros);

  // RC1: proveedor existe y activo.
  if (!proveedor) {
    bloqueos.push(`RC1: proveedor '${s.proveedor_nombre}' no existe en el maestro.`);
  } else if (!proveedor.activo) {
    bloqueos.push(`RC1: proveedor '${proveedor.nombre}' esta inactivo.`);
  }

  // RC4: la subarea pertenece al centro de costo.
  if (!centro) {
    bloqueos.push(`RC4: centro de costo '${s.centro_costo}' no existe.`);
  } else if (!centro.subareas.includes(s.subarea)) {
    bloqueos.push(`RC4: la subarea '${s.subarea}' no pertenece a ${centro.centro_costo}.`);
  }

  // RC2: aprobacion existe, dice "Aprobado" y viene de un aprobador del centro.
  const aprobador = centro && paquete.aprobacion ? centro.aprobadores.find((a) => a.email === paquete.aprobacion!.de) : undefined;
  if (!paquete.aprobacion || !paquete.aprobacion.aprobado) {
    bloqueos.push("RC2: no hay aprobacion valida (falta o no dice 'Aprobado').");
  } else if (centro && !aprobador) {
    bloqueos.push(`RC2: '${paquete.aprobacion.de}' no es aprobador de ${centro.centro_costo}.`);
  }

  // RC3: valor_total <= tope del aprobador (solo si el aprobador es valido para el centro).
  if (aprobador && s.valor_total > aprobador.tope) {
    bloqueos.push(`RC3: valor ${s.valor_total} supera el tope ${aprobador.tope} de ${aprobador.email}.`);
  }

  // RC10: cantidad * valor_unitario == valor_total (+-1).
  if (Math.abs(s.cantidad * s.valor_unitario - s.valor_total) > 1) {
    bloqueos.push(`RC10: cantidad x valor_unitario (${s.cantidad * s.valor_unitario}) no coincide con valor_total (${s.valor_total}).`);
  }

  // RC5: diferencia cotizacion vs solicitud <= 2%; sin cotizacion -> confirmacion.
  if (!paquete.cotizacion) {
    confirmaciones.push("RC5: no hay cotizacion para cruzar el valor.");
  } else {
    const dif = Math.abs(paquete.cotizacion.total - s.valor_total) / s.valor_total;
    if (dif > 0.02) {
      confirmaciones.push(`RC5: cotizacion ${paquete.cotizacion.total} vs solicitud ${s.valor_total} (${(dif * 100).toFixed(1)}% de diferencia).`);
    }
  }

  // RC6: indicador_iva ausente -> derivar del proveedor + confirmar.
  if (!s.indicador_iva && proveedor) {
    derivados.indicador_iva = proveedor.indicador_iva_default;
    confirmaciones.push(`RC6: IVA no informado, derivado del proveedor: ${proveedor.indicador_iva_default}.`);
  }

  // RC7: condiciones_pago ausente -> derivar del proveedor (solo informar).
  if (!s.condiciones_pago && proveedor) {
    derivados.condiciones_pago = proveedor.condiciones_pago_default;
  }

  // RC8: factura con fecha anterior a la solicitud -> retroactiva + confirmar.
  if (paquete.factura && paquete.factura.fecha && paquete.factura.fecha < soloFecha(s.fecha_solicitud)) {
    retroactiva = true;
    confirmaciones.push(`RC8: factura ${paquete.factura.numero} (${paquete.factura.fecha}) anterior a la solicitud (${s.fecha_solicitud}). OC retroactiva.`);
  }

  // RC9: fecha de aprobacion >= fecha_solicitud.
  if (paquete.aprobacion && soloFecha(paquete.aprobacion.fecha) < soloFecha(s.fecha_solicitud)) {
    confirmaciones.push(`RC9: la aprobacion (${soloFecha(paquete.aprobacion.fecha)}) es anterior a la solicitud (${soloFecha(s.fecha_solicitud)}).`);
  }

  return { apta: bloqueos.length === 0, bloqueos, confirmaciones, derivados, retroactiva };
}
