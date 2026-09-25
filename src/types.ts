// Tipos compartidos del dominio de ordenes de compra. Fuente unica de verdad de las formas de datos.

export type Moneda = "COP" | "USD";

export interface Solicitud {
  solicitud_id: string;
  solicitante: string;
  proveedor_nombre: string;
  proveedor_nit?: string | null;
  descripcion: string;
  centro_costo: string;
  subarea: string;
  cantidad: number;
  valor_unitario: number;
  valor_total: number;
  moneda: string;
  indicador_iva?: string | null;
  condiciones_pago?: string | null;
  fecha_solicitud: string;
}

export interface Paquete {
  correo: { id: string; de: string; asunto: string; fecha: string };
  solicitud: Solicitud;
  cotizacion:
    | { proveedor: string; nit: string | null; total: number; moneda: string; validez_hasta: string | null; texto: string }
    | null;
  aprobacion: { de: string; fecha: string; aprobado: boolean; texto: string } | null;
  factura: { numero: string; fecha: string; total: number } | null;
}

export interface ResultadoValidacion {
  apta: boolean;
  bloqueos: string[];
  confirmaciones: string[];
  derivados: Record<string, string>;
  retroactiva: boolean;
}

export interface OrdenCompra {
  referencia: { solicitud_id: string; correo_id: string; cotizacion_ref: string | null };
  sociedad: "1000";
  organizacion_compras: "1000";
  proveedor: { codigo_sap: string; nit: string; nombre: string };
  moneda: Moneda;
  condiciones_pago: string;
  aprobador: { email: string; fecha_aprobacion: string; evidencia_sha256: string };
  posiciones: Array<{
    numero: number;
    descripcion: string;
    cantidad: number;
    unidad: "UN" | "H" | "MES";
    precio_unitario: number;
    centro_costo: string;
    subarea: string;
    indicador_iva: string;
  }>;
  excepciones: Array<{ codigo: string; detalle: string; confirmado_por: string | null }>;
}

// Contrato uniforme de retorno de toda herramienta. Nunca se lanza una excepcion.
export type ToolResult<T> = { ok: true; data: T } | { ok: false; error: string };

// Maestros
export interface Proveedor {
  codigo_sap: string;
  nit: string;
  nombre: string;
  condiciones_pago_default: string;
  indicador_iva_default: string;
  activo: boolean;
}

export interface CentroCosto {
  centro_costo: string;
  nombre: string;
  subareas: string[];
  aprobadores: Array<{ email: string; nombre: string; tope: number }>;
}

export interface IndicadorIva {
  codigo: string;
  descripcion: string;
  tasa: number;
}

export interface CondicionPago {
  codigo: string;
  descripcion: string;
  dias: number;
}
