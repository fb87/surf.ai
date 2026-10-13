export class LlmApiError extends Error {
  constructor(message, kind, status, detail) {
    super(message);
    this.name = "LlmApiError";
    this.kind = kind; // 'auth' | 'network' | 'bad_response' | 'unknown'
    this.status = status;
    this.detail = detail; // human-readable message extracted from the provider's error body, if any
  }
}

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 4096;

function extractErrorDetail(text) {
  try {
    const json = JSON.parse(text);
    return json?.error?.message || json?.message || null;
  } catch {
    return text ? text.slice(0, 300) : null;
  }
}

function isAnthropicBaseUrl(baseUrl) {
  try {
    return new URL(baseUrl).hostname.endsWith("anthropic.com");
  } catch {
    return false;
  }
}

export async function chatCompletion({ baseUrl, apiKey, model, messages, responseFormat, tools, temperature = 0.3, maxTokens }) {
  if (isAnthropicBaseUrl(baseUrl)) {
    // Tool-calling against Anthropic's native Messages API uses a structurally
    // different shape (input_schema, tool_use/tool_result content blocks) and
    // isn't implemented yet — tools are silently ignored on this path, so Ask
    // falls back to context-only answers rather than failing outright.
    return callAnthropicMessages({ baseUrl, apiKey, model, messages, temperature, maxTokens });
  }
  return callOpenAiCompatible({ baseUrl, apiKey, model, messages, responseFormat, tools, temperature, maxTokens });
}

async function callOpenAiCompatible({ baseUrl, apiKey, model, messages, responseFormat, tools, temperature, maxTokens }) {
  const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const body = {
    model,
    messages,
    temperature,
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
    ...(tools && tools.length ? { tools, tool_choice: "auto" } : {}),
  };

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new LlmApiError(`Network error contacting the LLM endpoint: ${err.message}`, "network");
  }

  if (res.status === 401 || res.status === 403) {
    throw new LlmApiError("Authentication failed — check your API key.", "auth", res.status);
  }
  if (res.status === 429) {
    const text = await res.text().catch(() => "");
    const detail = extractErrorDetail(text);
    throw new LlmApiError(`Rate limit exceeded on the LLM endpoint${detail ? `: ${detail}` : "."}`, "rate_limited", res.status, detail);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const detail = extractErrorDetail(text);
    throw new LlmApiError(`LLM endpoint returned status ${res.status}${detail ? `: ${detail}` : ""}.`, "unknown", res.status, detail);
  }

  let json;
  try {
    json = await res.json();
  } catch (err) {
    throw new LlmApiError("LLM endpoint returned a response that wasn't valid JSON.", "bad_response");
  }

  const message = json?.choices?.[0]?.message;
  const rawToolCalls = message?.tool_calls;
  const toolCalls = Array.isArray(rawToolCalls) && rawToolCalls.length
    ? rawToolCalls.map((tc) => ({ id: tc.id, name: tc.function?.name, arguments: tc.function?.arguments }))
    : undefined;

  const content = message?.content;
  if (typeof content !== "string" && !toolCalls) {
    throw new LlmApiError("LLM response was missing choices[0].message.content.", "bad_response");
  }
  return { content: typeof content === "string" ? content : "", toolCalls, raw: json };
}

// Anthropic's OpenAI-compatibility shim (/v1/chat/completions) does not allow
// direct browser CORS requests at all ("Disallowed CORS origin"). Their native
// Messages API (/v1/messages) does, but only when the browser explicitly opts
// in via the `anthropic-dangerous-direct-browser-access` header, uses `x-api-key`
// instead of a Bearer token, and speaks a different request/response shape
// (system prompt as a top-level field, `max_tokens` required, response content
// as an array of blocks rather than choices[0].message.content).
async function callAnthropicMessages({ baseUrl, apiKey, model, messages, temperature, maxTokens }) {
  const origin = new URL(baseUrl).origin;
  const url = `${origin}/v1/messages`;

  const systemMessages = messages.filter((m) => m.role === "system").map((m) => m.content);
  const conversationMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  const body = {
    model,
    max_tokens: maxTokens || DEFAULT_MAX_TOKENS,
    temperature,
    messages: conversationMessages,
    ...(systemMessages.length ? { system: systemMessages.join("\n\n") } : {}),
  };

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new LlmApiError(`Network error contacting the Anthropic API: ${err.message}`, "network");
  }

  if (res.status === 401 || res.status === 403) {
    throw new LlmApiError("Authentication failed — check your API key.", "auth", res.status);
  }
  if (res.status === 429) {
    const text = await res.text().catch(() => "");
    const detail = extractErrorDetail(text);
    throw new LlmApiError(`Rate limit exceeded on the Anthropic API${detail ? `: ${detail}` : "."}`, "rate_limited", res.status, detail);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const detail = extractErrorDetail(text);
    throw new LlmApiError(`Anthropic API returned status ${res.status}${detail ? `: ${detail}` : ""}.`, "unknown", res.status, detail);
  }

  let json;
  try {
    json = await res.json();
  } catch (err) {
    throw new LlmApiError("Anthropic API returned a response that wasn't valid JSON.", "bad_response");
  }

  const content = (json?.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  if (!content) {
    throw new LlmApiError("Anthropic response contained no text content.", "bad_response");
  }
  return { content, raw: json };
}

// Lists available models from a provider's /models endpoint, for populating
// the Model field's suggestions. Returns an array of model id strings.
export async function listModels({ baseUrl, apiKey }) {
  const isAnthropic = isAnthropicBaseUrl(baseUrl);
  const url = isAnthropic ? `${new URL(baseUrl).origin}/v1/models` : `${baseUrl.replace(/\/+$/, "")}/models`;
  const headers = isAnthropic
    ? { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION, "anthropic-dangerous-direct-browser-access": "true" }
    : { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };

  let res;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    throw new LlmApiError(`Network error listing models: ${err.message}`, "network");
  }

  if (res.status === 401 || res.status === 403) {
    throw new LlmApiError("Authentication failed — check your API key.", "auth", res.status);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const detail = extractErrorDetail(text);
    throw new LlmApiError(`Listing models returned status ${res.status}${detail ? `: ${detail}` : ""}.`, "unknown", res.status, detail);
  }

  let json;
  try {
    json = await res.json();
  } catch {
    throw new LlmApiError("Model list response wasn't valid JSON.", "bad_response");
  }

  const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
  return list.map((m) => m.id || m.name).filter((id) => typeof id === "string").sort();
}
