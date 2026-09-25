// Ciclo del agente: prompt -> modelo -> herramientas -> respuesta, con tope de iteraciones
// y deteccion de confirmacion humana. Independiente del proveedor LLM (usa LlmAdapter).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { DefinicionHerramienta, LlmAdapter, MensajeChat } from "./llm/adapter";
import { herramientas, type Ctx } from "./tools/oc";

const MAX_ITERACIONES = Number(process.env.MAX_ITERACIONES ?? 25);

export interface ToolCallVisible {
  name: string;
  arguments: string;
  resultado: string;
}

export interface RespuestaChat {
  reply: string;
  toolCalls: ToolCallVisible[];
  needsConfirmation: boolean;
}

// Construye el system prompt combinando comportamiento (prompt.md) y conocimiento (knowledge/).
function construirSystemPrompt(directory: string): string {
  const prompt = readFileSync(join(directory, "agent", "prompt.md"), "utf8");
  const conocimiento = readFileSync(join(directory, "src", "knowledge", "ordenes-compra.md"), "utf8");
  return `${prompt}\n\n---\n\n# Conocimiento del proceso\n\n${conocimiento}`;
}

// Deriva las definiciones de herramientas para el modelo desde el registro `herramientas`.
function definicionesHerramientas(): DefinicionHerramienta[] {
  return Object.entries(herramientas).map(([clave, h]) => ({
    name: `oc_${clave}`,
    description: h.description,
    parameters: zodToJsonSchema(z.object(h.args as Record<string, z.ZodTypeAny>)) as Record<string, unknown>,
  }));
}

type Herramienta = (typeof herramientas)[keyof typeof herramientas];

function buscarHerramienta(nombre: string): { clave: string; h: Herramienta } | null {
  const clave = nombre.replace(/^oc_/, "");
  const h = (herramientas as Record<string, Herramienta>)[clave];
  return h ? { clave, h } : null;
}

const sesiones = new Map<string, MensajeChat[]>();

export function historial(sessionId: string): MensajeChat[] {
  return sesiones.get(sessionId) ?? [];
}

export async function chat(sessionId: string, mensajeUsuario: string, adapter: LlmAdapter, ctx: Ctx): Promise<RespuestaChat> {
  const historia = sesiones.get(sessionId) ?? [{ role: "system", content: construirSystemPrompt(ctx.directory) }];
  historia.push({ role: "user", content: mensajeUsuario });

  const defs = definicionesHerramientas();
  const toolCallsVisibles: ToolCallVisible[] = [];
  let needsConfirmation = false;

  for (let i = 0; i < MAX_ITERACIONES; i++) {
    const resp = await adapter.enviar(historia, defs);

    if (resp.toolCalls.length === 0) {
      const reply = resp.texto ?? "(sin respuesta)";
      historia.push({ role: "assistant", content: reply });
      sesiones.set(sessionId, historia);
      return { reply, toolCalls: toolCallsVisibles, needsConfirmation };
    }

    historia.push({ role: "assistant", content: resp.texto ?? "", tool_calls: resp.toolCalls });

    for (const tc of resp.toolCalls) {
      const encontrada = buscarHerramienta(tc.name);
      let resultado: string;
      if (!encontrada) {
        resultado = JSON.stringify({ ok: false, error: `herramienta desconocida: ${tc.name}` });
      } else {
        // Validacion de argumentos con zod antes de ejecutar (el error vuelve al modelo).
        const esquema = z.object(encontrada.h.args as Record<string, z.ZodTypeAny>);
        const parsed = esquema.safeParse(safeJson(tc.arguments));
        if (!parsed.success) {
          resultado = JSON.stringify({ ok: false, error: `argumentos invalidos: ${parsed.error.issues.map((x) => x.message).join("; ")}` });
        } else {
          resultado = await encontrada.h.execute(parsed.data as never, ctx);
        }
      }

      if (resultado.includes("requiere confirmacion")) needsConfirmation = true;
      historia.push({ role: "tool", tool_call_id: tc.id, content: resultado });
      toolCallsVisibles.push({ name: tc.name, arguments: tc.arguments, resultado: resumir(resultado) });
    }
  }

  const reply = "Alcance el tope de iteraciones. Esto es lo que tengo hasta ahora; dime como continuo.";
  historia.push({ role: "assistant", content: reply });
  sesiones.set(sessionId, historia);
  return { reply, toolCalls: toolCallsVisibles, needsConfirmation };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function resumir(resultado: string): string {
  return resultado.length > 400 ? resultado.slice(0, 400) + "…" : resultado;
}
