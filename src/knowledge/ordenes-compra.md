# Conocimiento del proceso — Órdenes de Compra

## Qué es
Cada compra de Periferia llega por correo con: solicitud (Excel→JSON), cotización del proveedor
(PDF→texto) y correo de aprobación del líder. La analista digita la OC en SAP y adjunta la
aprobación como evidencia.

## Controles que se verifican (RC1–RC10)

- **RC1 (bloqueo)**: el proveedor debe existir en el maestro (por NIT; si no hay NIT, por nombre
  normalizado) y estar `activo`.
- **RC2 (bloqueo)**: la aprobación debe existir, contener "Aprobado" y venir de un correo listado
  como aprobador del centro de costo.
- **RC3 (bloqueo)**: `valor_total` ≤ `tope` del aprobador para ese centro.
- **RC4 (bloqueo)**: la `subarea` debe pertenecer al `centro_costo`.
- **RC5 (confirmación)**: la diferencia relativa entre el total de la cotización y `valor_total`
  debe ser ≤ 2%. Si excede, o no hay cotización, se pide confirmación.
- **RC6 (confirmación + derivado)**: si falta `indicador_iva`, se deriva del proveedor y se confirma.
- **RC7 (derivado)**: si falta `condiciones_pago`, se deriva del proveedor. Solo se informa.
- **RC8 (confirmación)**: si existe una factura con fecha anterior a `fecha_solicitud`, la OC es
  **retroactiva**. Se confirma y se registra en el control.
- **RC9 (confirmación)**: la fecha de aprobación debe ser ≥ `fecha_solicitud`.
- **RC10 (bloqueo)**: `cantidad × valor_unitario` debe igualar `valor_total` (± 1).

## Desvío de proceso a medir
Muchas OC se crean **después** de recibir la factura (retroactivas), saltándose la cotización.
La dirección quiere medir qué porcentaje son retroactivas. Por eso `retroactiva` se registra en
`out/control.csv`.

## Evidencia
El correo de aprobación se guarda como `aprobacion.txt` (P0) con su `sha256`, y opcionalmente
`aprobacion.pdf` (P1). Sustenta el gasto ante auditoría.
