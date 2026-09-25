# SOLUCION.md — Reto 03 · Agente "Órdenes de Compra SAP"

## 1. Problema en una frase

La analista administrativa digita a mano cada orden de compra en SAP a partir de un paquete de
correo (solicitud + cotización + aprobación), con alto costo de error y sin control sistemático de
quién puede aprobar qué; le duele a Administración (tiempo/error), a Auditoría (control del gasto)
y a la Dirección (no puede medir cuántas OC son retroactivas).

---

## 2. Arquitectura

```
┌──────────────┐  HTTP   ┌──────────────────────────────────────────────┐
│ web/index    │ ──────▶ │ src/server.ts  (Bun.serve)                    │
│  chat + tool │ ◀────── │   /api/chat  /api/sessions/:id  /api/health   │
│  calls + ⚠️  │         │                                              │
└──────────────┘         │  src/agent.ts  ── ciclo del agente            │
                         │     prompt.md + knowledge/  → system prompt   │
                         │     tope de iteraciones · confirmación        │
                         │        │                    ▲                 │
                         │        ▼                    │                 │
                         │  src/llm/openai.ts  (LlmAdapter)              │
                         │        │                                     │
                         │        ▼                                     │
                         │  src/tools/oc.ts  (5 herramientas zod)        │
                         │     src/validacion.ts (RC1-RC10)              │
                         │     src/util.ts (parseo, maestros, logs)      │
                         │     src/sap/mock.ts (SapAdapter)              │
                         └───────┬──────────────────────┬───────────────┘
                          fixtures/ (solo lectura)     out/ (escritura)
```

Separación de responsabilidades (lo que evalúa el PRD):
- **Comportamiento** → `agent/prompt.md`.
- **Conocimiento del proceso** → `src/knowledge/ordenes-compra.md`.
- **Ejecución/datos** → `src/tools/oc.ts` (+ `validacion.ts`, `util.ts`, `sap/mock.ts`).

Un cambio de reglas de negocio no toca el servidor: se edita `validacion.ts` o el conocimiento.

---

## 3. Ciclo del agente

Implementado en `src/agent.ts` como un bucle `while` con tope de iteraciones (`MAX_ITERACIONES`, 25):

1. Se arma el historial con el system prompt (prompt.md + knowledge) y el mensaje del usuario.
2. Se llama al modelo con el historial + las definiciones de herramientas (derivadas de `zod` con
   `zod-to-json-schema`).
3. Si el modelo responde **texto** → fin del turno.
4. Si pide **herramientas** → cada llamada se **valida con `zod`** antes de ejecutar (un error vuelve
   al modelo, no rompe la sesión), se ejecuta, y el resultado se agrega al historial como mensaje `tool`.
5. Se repite hasta texto final o hasta el tope (entonces responde con lo que tiene).

**Confirmación humana (CA3)**: las herramientas señalan la excepción. `oc_crear` sin `confirmado=true`
devuelve `{ ok:false, error:"requiere confirmacion: ..." }`. El agente detecta ese estado
(`needsConfirmation`) y el front lo resalta. La OC solo se crea si el usuario confirma en el
siguiente mensaje. El **doble candado** vive en la herramienta (no crea) y en el flujo (el modelo pregunta).

**No inventar valores (CA2)**: el modelo solo orquesta; todo dato sale de una herramienta. Por eso
`demo.ts` corre sin clave: prueba toda la lógica de negocio sin el LLM.

---

## 4. Elección del modelo

- **Proveedor/modelo**: OpenAI `gpt-4o-mini` (configurable con `OPENAI_MODEL`).
- **Por qué**: la tarea es orquestación con herramientas (no razonamiento pesado), donde `gpt-4o-mini`
  es rápido, barato y con soporte nativo de *function calling*. El adaptador (`LlmAdapter`) aísla el
  proveedor: cambiar a otro solo toca `src/llm/`.
- **Costo estimado por caso**: un caso son ~4-6 llamadas al modelo con contexto pequeño
  (system + herramientas + resultados JSON breves). Con `gpt-4o-mini` (~US$0.15/1M input,
  ~US$0.60/1M output) el orden de magnitud es **< US$0.01 por caso**. La demo determinista no consume nada.

---

## 5. Matriz de controles RC1–RC10

Implementados en `src/validacion.ts` como función pura `(paquete, maestros) → { apta, bloqueos,
confirmaciones, derivados, retroactiva }`.

| # | Regla | Tipo | Implementación |
|---|---|---|---|
| RC1 | Proveedor existe (NIT normalizado; si no, nombre normalizado) y `activo` | Bloqueo | `resolverProveedor` |
| RC2 | Aprobación existe, dice "Aprobado" y viene de un aprobador del centro | Bloqueo | match email en `aprobadores` |
| RC3 | `valor_total` ≤ tope del aprobador | Bloqueo | comparación con `tope` |
| RC4 | `subarea` pertenece al `centro_costo` | Bloqueo | `subareas.includes` |
| RC5 | \|cotiz − sol\|/sol ≤ 2%; sin cotización → confirmación | Confirmación | diferencia relativa |
| RC6 | `indicador_iva` ausente → derivar + confirmar | Confirmación + derivado | `indicador_iva_default` |
| RC7 | `condiciones_pago` ausente → derivar (informar) | Derivado | `condiciones_pago_default` |
| RC8 | Factura con fecha < solicitud → `retroactiva` + confirmar | Confirmación | comparación de fechas |
| RC9 | Fecha de aprobación ≥ solicitud | Confirmación | comparación de fechas |
| RC10 | `cantidad × valor_unitario` = `valor_total` (±1) | Bloqueo | aritmética |

**La más difícil**: RC2/RC3 juntas. `sol-003` lo ilustra: el aprobador (`fvargas`, de CC-3030) no
pertenece a CC-2020, así que el bloqueo correcto es **RC2** (autoridad por centro), no solo el tope.
Modelar "aprobador válido para *este* centro" antes de comparar el tope evita falsos OK.

Resultado verificado de la demo:

| Caso | Resultado | Control |
|---|---|---|
| sol-001 | CREADA · OC 4500000001 | apta |
| sol-002 | BLOQUEADA | RC1 |
| sol-003 | BLOQUEADA | RC2 |
| sol-004 | PENDIENTE → CREADA (confirmado) · OC 4500000002 | RC5 (6%) |
| sol-005 | PENDIENTE · retroactiva | RC8 |
| sol-006 | PENDIENTE | RC6 (deriva C1) |

Idempotencia comprobada: `sol-001` dos veces → misma OC, sin segunda escritura.

---

## 6. Diseño del adaptador SAP real (sección 7.5)

Hoy `src/sap/mock.ts` implementa la interfaz `SapAdapter` sobre archivos. Para producción:

- **Opción elegida**: **OData** `API_PURCHASEORDER_PROCESS_SRV` (S/4HANA) por ser síncrona, tipada,
  con manejo estándar de errores y más simple de operar que RFC/BAPI `BAPI_PO_CREATE1` desde Node.
  Si el landscape es ECC sin OData, plan B: RFC vía un microservicio, o carga por archivo (LSMW/BAPI batch).
- **Mapeo del payload (7.4) → OData**: `proveedor.codigo_sap → Supplier`;
  `sociedad → CompanyCode`; `organizacion_compras → PurchasingOrganization`;
  `condiciones_pago → PaymentTerms`; cada `posiciones[]` → `to_PurchaseOrderItem`
  (`Material`/`PurchaseOrderItemText`, `OrderQuantity`, `NetPriceAmount`, `CostCenter`, `TaxCode`).
- **Autenticación**: OAuth2 client-credentials o certificado; las credenciales viven en un secret
  manager (Azure Key Vault), **nunca** en el agente, el prompt ni los logs.
- **Idempotencia frente a reintentos**: clave de idempotencia = `solicitud_id`. Antes de crear se
  llama `buscarOrdenPorReferencia` (en SAP: buscar por `PurchaseOrderItem` con el `solicitud_id` en un
  campo de referencia/`YourReference`). Si SAP responde error parcial, se registra el estado y se
  reintenta solo la operación fallida; no se crea una segunda OC.
- **Plan B si no hay conexión**: el agente igual ahorra tiempo generando el payload validado listo
  para pegar en SAP GUI o un archivo de carga masiva, más la evidencia de aprobación.

---

## 7. Lectura del proceso — OC retroactivas

A la Dirección: hoy no se puede afirmar qué porcentaje de OC se crean **después** de la factura
porque nadie lo mide. Este agente lo vuelve observable: `RC8` marca `retroactiva=true` y lo deja en
`out/control.csv`, así el indicador sale solo. Propuesta de cambio de proceso: hacer **obligatoria la
cotización previa** y bloquear (no solo confirmar) la creación retroactiva salvo excepción aprobada por
un rol de control; medir mensualmente el % retroactivo y ponerle meta a la baja. El objetivo no es
castigar, es que la OC deje de ser un trámite posterior a la factura y vuelva a ser un control previo al gasto.

---

## 8. Decisiones y trade-offs

1. **Extracción determinista (regex) vs. LLM para leer cotización/factura.** Elegí regex en
   `util.ts`. Trade-off: menos robusto ante formatos nuevos, pero **determinista, gratis y auditable**,
   y el PRD entrega el texto ya normalizado. El LLM queda para orquestar, no para extraer valores.
2. **Validación centralizada re-ejecutada en `oc_crear`.** `oc_crear` vuelve a validar en vez de
   confiar en el payload recibido. Trade-off: recomputa, pero garantiza que **nunca** se cree algo que
   no cumple, aunque el modelo intente saltarse pasos.
3. **Sesiones en memoria (Map) vs. persistencia.** Elegí memoria por simplicidad y porque el PRD no
   pide BD. Trade-off: se pierden al reiniciar; para producción se movería a un store con TTL.

---

## 9. Supuestos

- Los fixtures representan la variabilidad real; en producción habrá cotizaciones peores (OCR, PDF).
- El NIT del maestro no trae dígito de verificación; se normaliza descartándolo.
- Una sola posición por OC (los casos son de un ítem). El diseño admite N posiciones.
- `unidad` se fija en `UN` por defecto (los fixtures no la traen); ajustable por ítem.
- Fecha de referencia = fecha de ejecución (las comparaciones RC8/RC9 usan las fechas de los fixtures).

---

## 10. Cobertura de historias de usuario

| HU | Estado | Nota |
|---|---|---|
| HU-1 Leer el paquete | Hecho | `oc_leer_paquete` normaliza correo/solicitud/cotización/aprobación/factura |
| HU-2 Validar contra maestros | Hecho | RC1–RC10 en `validacion.ts` |
| HU-3 Construir payload | Hecho | `oc_construir_payload` + `trazabilidad.json`, validado con `zod` |
| HU-4 Evidencia de aprobación | Hecho (P0) | `aprobacion.txt` + `sha256`. PDF (P1) pendiente |
| HU-5 Crear en SAP simulado | Hecho | idempotente, `control.csv`, numeración `4500000001+` |
| HU-6 Manejo de errores | Hecho | herramientas devuelven `{ ok:false, error }`, nunca lanzan |
| Chat/agente | Hecho | ciclo, tope, confirmación, front con tool calls |
| Evidencia PDF (P1) | No hecho | falta `pdf-lib`; el txt cumple P0 |
| Lectura de Excel real (P1) | No hecho | fixtures ya vienen como JSON |

Para producción falta: OCR, adaptador SAP real, persistencia de sesiones, tope de tokens por sesión
efectivo, y PDF de evidencia.

---

## 11. Uso de IA

- **Asistente**: GitHub Copilot (Claude) para diseño de la arquitectura, andamiaje TypeScript,
  implementación de herramientas/validación y redacción de esta documentación.
- **Para qué**: acelerar la escritura de código idiomático en TS (lenguaje no habitual del autor) y
  estructurar la spec.
- **Qué se descartó**: propuestas de leer las cotizaciones con el LLM (se prefirió regex determinista
  por costo/auditoría) y de persistir en BD (fuera de alcance). Cada línea entregada es explicable.

---

## 12. Riesgos en producción y mitigación

- **El modelo intenta afirmar un valor no derivado.** Mitigación: herramientas como única fuente;
  `oc_crear` re-valida; el prompt lo prohíbe.
- **Formatos de cotización nuevos rompen el regex.** Mitigación: la extracción es una capa aislada
  en `util.ts`; se puede reforzar o combinar con LLM sin tocar el resto.
- **Fuga de la clave de OpenAI.** Mitigación: solo en `.env` del backend, en `.gitignore`, nunca en
  front/logs/respuestas; `/api/health` no la expone.
- **Costo descontrolado.** Mitigación: tope de iteraciones por turno; añadir tope de tokens por sesión.
- **Creación duplicada por reintentos.** Mitigación: idempotencia por `solicitud_id` en el adaptador.
