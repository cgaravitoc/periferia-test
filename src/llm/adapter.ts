// Interfaz del proveedor LLM. openai.ts la implementa. Cambiar de proveedor no toca el ciclo del agente.

export interface MensajeChat {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface DefinicionHerramienta {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface RespuestaLLM {
  texto: string | null;
  toolCalls: ToolCall[];
}

export interface LlmAdapter {
  enviar(mensajes: MensajeChat[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLLM>;
}
