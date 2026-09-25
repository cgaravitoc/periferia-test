# Mini-spec — Reto 03 · Órdenes de Compra SAP

> Especificación operativa de 1 página. El `PRD.md` es la spec completa; esto la aterriza al código.
> Doble uso: alimenta la sección "Arquitectura" y "Matriz de controles" de `SOLUCION.md`.

---

## 1. Contrato de herramientas (`src/tools/oc.ts`)

Cada export → nombre visible para el modelo `oc_<export>`. Todas devuelven **string JSON**
`{ ok:true, data }` o `{ ok:false, error }`. **Nunca lanzan.**

| Herramienta | Entrada | Salida (`data`) | Prioridad |
|---|---|---|---|
| `oc_leer_paquete` | `{ caso }` | `Paquete` normalizado (correo, solicitud, cotizacion, aprobacion, factura?) | P0 |
| `oc_validar` | `{ caso, paquete }` | `{ apta, bloqueos[], confirmaciones[], derivados, retroactiva }` | P0 |
| `oc_construir_payload` | `{ caso, paquete, derivados }` | `OrdenCompra` + ruta de `trazabilidad.json` | P0 |
| `oc_generar_evidencia` | `{ caso }` | `{ ruta, sha256 }` (txt P0, pdf P1) | P0 |
| `oc_crear` | `{ caso, payload, confirmado? }` | `{ numero_oc, fecha, idempotente }` o `{ ok:false, error }` | P0 |

Regla dura de `oc_crear`: solo ejecuta si `apta = true` **y** (`confirmaciones` vacío **o** `confirmado = true`).

---

## 2. Fuentes de datos (trazabilidad obligatoria)

Todo valor del payload es trazable a: `solicitud`, `cotizacion`, `maestro.<nombre>` o `derivado`.
Se guarda en `out/<caso>/trazabilidad.json`.

| Maestro | Archivo | Uso |
|---|---|---|
| Proveedores | `maestros/proveedores.json` | RC1 (existe+activo), código SAP, defaults IVA/pago |
| Centros de costo | `maestros/centros-costo.json` | RC2 (aprobador), RC3 (tope), RC4 (subárea) |
| Indicadores IVA | `maestros/indicadores-iva.json` | validar/derivar `indicador_iva` |
| Condiciones de pago | `maestros/condiciones-pago.json` | validar/derivar `condiciones_pago` |

---

## 3. Matriz de controles RC1–RC10

| # | Regla | Tipo | Cómo se implementa |
|---|---|---|---|
| RC1 | Proveedor existe (por NIT; si no hay NIT, por nombre normalizado) y `activo` | **Bloqueo** | buscar en `proveedores.json` |
| RC2 | Aprobación existe, contiene "Aprobado" y viene de un aprobador del `centro_costo` | **Bloqueo** | `aprobacion.aprobado` + email en `aprobadores` del centro |
| RC3 | `valor_total` ≤ `tope` del aprobador para ese centro | **Bloqueo** | comparar contra `tope` |
| RC4 | `subarea` pertenece al `centro_costo` | **Bloqueo** | `subareas.includes(subarea)` |
| RC5 | `abs(cotiz.total − sol.valor_total)/sol.valor_total` ≤ 2%. Excede o sin cotización → confirmación | Confirmación | diferencia relativa |
| RC6 | `indicador_iva` ausente → derivar de proveedor + confirmar | Confirmación + derivado | `indicador_iva_default` |
| RC7 | `condiciones_pago` ausente → derivar de proveedor. Solo informar | Derivado | `condiciones_pago_default` |
| RC8 | Existe `factura` con `fecha` < `fecha_solicitud` → `retroactiva=true` + confirmar | Confirmación | comparar fechas |
| RC9 | Fecha de aprobación ≥ `fecha_solicitud`. Si no → confirmación | Confirmación | comparar fechas |
| RC10 | `cantidad × valor_unitario` = `valor_total` (± 1) | **Bloqueo** | aritmética |

---

## 4. Resultado esperado por caso (verificado contra fixtures)

| Caso | Proveedor / Centro | Disparadores | Resultado |
|---|---|---|---|
| `sol-001` | TecnoSuministros ✓ / CC-1010, mlopez tope 50M | valor 11.4M ✓, cotiz 11.4M=sol ✓, IVA C1 ✓, 120×95000 ✓ | **apta, sin confirmaciones → OC creada** |
| `sol-002` | "Soluciones Digitales del Norte" NIT 901999000 **no existe** | RC1 | **BLOQUEO — no crea** |
| `sol-003` | Mobiliario Andino ✓ / CC-2020, aprobador fvargas (es de CC-3030) | RC2 (aprobador no pertenece al centro) | **BLOQUEO — no crea** |
| `sol-004` | Cloud Andina ✓ / CC-1010, dgarcia tope 200M | cotiz 26.5M vs sol 25M = 6% > 2% → RC5 | **CONFIRMACIÓN → crea con confirmado** |
| `sol-005` | Papelería Central ✓ / CC-2020, rtorres tope 30M | cotiz 3.2M = sol ✓; factura 2026-08-10 < sol 2026-08-27 → RC8 | **CONFIRMACIÓN + retroactiva=true** |
| `sol-006` | TecnoSuministros (sin NIT, resolver por nombre) / CC-1010, mlopez | cotiz 5.4M = sol ✓; sin IVA → RC6 (deriva C1); sin cond. pago → RC7 (deriva Z030) | **CONFIRMACIÓN → crea con confirmado** |

---

## 5. SAP mock (`src/sap/mock.ts`)

- `crearOrden`: número secuencial desde `4500000001`, escribe en `out/sap/ordenes.jsonl`.
- `buscarOrdenPorReferencia(solicitud_id)`: idempotencia — si ya existe, devuelve el número existente.
- Cada intento (creado/bloqueado/pendiente) agrega fila a `out/control.csv`:
  `solicitud_id, resultado, numero_oc, retroactiva, bloqueos, confirmaciones, ts`.

---

## 6. Payload OC (validado con zod) — resumen

`{ referencia, sociedad:"1000", organizacion_compras:"1000", proveedor{codigo_sap,nit,nombre},
moneda, condiciones_pago, aprobador{email,fecha_aprobacion,evidencia_sha256},
posiciones[{numero,descripcion(max40),cantidad,unidad,precio_unitario,centro_costo,subarea,indicador_iva}],
excepciones[{codigo,detalle,confirmado_por}] }`
