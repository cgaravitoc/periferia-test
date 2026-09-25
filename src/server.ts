// Servidor HTTP (Bun) + ciclo del agente. Expone /api/chat, /api/sessions/:id, /api/health.
import { join } from "node:path";
import { z } from "zod";
import { chat, historial } from "./agent";
import { crearOpenAiAdapter } from "./llm/openai";

const PORT = Number(process.env.PORT ?? 3000);
const directory = process.cwd();
const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

const chatSchema = z.object({ sessionId: z.string().min(1), message: z.string().min(1) });

// El adaptador se crea perezosamente para que /api/health funcione aunque falte la clave.
let adapter: ReturnType<typeof crearOpenAiAdapter> | null = null;
function obtenerAdapter() {
  if (!adapter) adapter = crearOpenAiAdapter();
  return adapter;
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, provider: "openai", model });
    }

    if (url.pathname === "/api/chat" && req.method === "POST") {
      const body = chatSchema.safeParse(await req.json().catch(() => null));
      if (!body.success) return Response.json({ ok: false, error: "body invalido: se requiere { sessionId, message }" }, { status: 400 });
      try {
        const res = await chat(body.data.sessionId, body.data.message, obtenerAdapter(), { directory, sessionId: body.data.sessionId });
        return Response.json({ ok: true, ...res });
      } catch (e) {
        return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname.startsWith("/api/sessions/")) {
      const id = url.pathname.slice("/api/sessions/".length);
      return Response.json({ ok: true, sessionId: id, mensajes: historial(id) });
    }

    // Front estatico.
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(Bun.file(join(directory, "web", "index.html")));
    }

    return new Response("No encontrado", { status: 404 });
  },
});

console.log(`Servidor escuchando en http://localhost:${server.port}`);

