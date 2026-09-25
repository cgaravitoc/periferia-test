// Implementacion del adaptador LLM para OpenAI. Traduce nuestro formato al de la API de OpenAI.
import OpenAI from "openai";
import type { DefinicionHerramienta, LlmAdapter, MensajeChat, RespuestaLLM } from "./adapter";

type OpenAiMsg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function aFormatoOpenAi(m: MensajeChat): OpenAiMsg {
  if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
    return {
      role: "assistant",
      content: m.content || null,
      tool_calls: m.tool_calls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.arguments } })),
    };
  }
  if (m.role === "tool") {
    return { role: "tool", tool_call_id: m.tool_call_id ?? "", content: m.content };
  }
  return { role: m.role, content: m.content } as OpenAiMsg;
}

export function crearOpenAiAdapter(): LlmAdapter {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Falta OPENAI_API_KEY en el entorno del backend.");
  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  return {
    async enviar(mensajes: MensajeChat[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLLM> {
      const respuesta = await client.chat.completions.create({
        model,
        messages: mensajes.map(aFormatoOpenAi),
        tools: herramientas.map((h) => ({ type: "function", function: { name: h.name, description: h.description, parameters: h.parameters } })),
        tool_choice: "auto",
      });
      const msg = respuesta.choices[0]?.message;
      const toolCalls = (msg?.tool_calls ?? [])
        .filter((t): t is OpenAI.Chat.Completions.ChatCompletionMessageToolCall & { type: "function" } => t.type === "function")
        .map((t) => ({ id: t.id, name: t.function.name, arguments: t.function.arguments }));
      return { texto: msg?.content ?? null, toolCalls };
    },
  };
}

