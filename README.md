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

## Despliegue

El proyecto trae `Dockerfile`, `.dockerignore` y `render.yaml`.

### Opción A — Render (Docker, nube)
1. Sube este proyecto a un repositorio GitHub (la raíz del repo es esta carpeta).
2. En Render: **New → Blueprint** y apunta al repo (usa `render.yaml`).
3. En el panel del servicio, configura la variable `OPENAI_API_KEY` (marcada `sync: false`).
4. Deploy. El health check es `/api/health`.

### Opción B — Docker local / cualquier host
```bash
docker build -t reto-03-oc .
docker run -p 3000:3000 -e OPENAI_API_KEY=tu-clave reto-03-oc
```
Abre http://localhost:3000.

### Opción C — Túnel (link público temporal)
Con el servidor local corriendo (`bun run dev`):
```bash
cloudflared tunnel --url http://localhost:3000
```
Usa la URL HTTPS que imprime. Válida mientras el túnel y tu PC estén encendidos.

