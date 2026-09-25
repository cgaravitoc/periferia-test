# Reto 03 — Agente "Órdenes de Compra SAP"

Agente conversacional que prepara y crea órdenes de compra en un SAP simulado a partir de un
paquete de correo (solicitud + cotización + aprobación), con validación de controles y humano en el bucle.

## Requisitos
- [Bun](https://bun.sh) (o Node 20+).
- Una clave de OpenAI (solo para el chat; la demo NO la necesita).

## Instalación
```bash
bun install
cp .env.example .env   # y coloca tu OPENAI_API_KEY
```

## Ejecutar la demo (sin modelo, determinista)
```bash
bun run demo.ts
```
Recorre los 6 casos de `fixtures/reto-03/solicitudes/` llamando las herramientas directamente.

## Levantar el agente (chat)
```bash
bun run dev
```
Abre `web/index.html` contra `http://localhost:3000`.

## Estructura
- `agent/prompt.md` — comportamiento del agente.
- `src/knowledge/` — conocimiento del proceso.
- `src/tools/oc.ts` — herramientas (única fuente de datos verídicos).
- `src/sap/` — interfaz y mock de SAP.
- `src/llm/` — interfaz y adaptador de OpenAI.
- `demo.ts` — verificación sin modelo.
- `notes/` — estrategia y mini-spec.

## Seguridad
La clave del modelo vive solo en `.env` (backend). Nunca en el front, el repo ni los logs.
