import { chatCompletion } from "../llm/llm-client.js";
import { getAdapterById } from "../providers/detect.js";
import { getGitToken } from "../storage/cache.js";

const CONTEXT_BUDGET_CHARS = 40_000;
const MAX_HISTORY_TURNS = 6;
const MAX_TOOL_ITERATIONS = 8;
const MAX_SEARCH_RESULTS = 30;
const MAX_FILE_FETCH_CHARS = 20_000;

const treeCache = new Map(); // "host/owner/repo/branch" -> Promise<TreeEntry[]>

function treeCacheKey(wikiData) {
  return `${wikiData.host.toLowerCase()}/${wikiData.owner.toLowerCase()}/${wikiData.repo.toLowerCase()}/${wikiData.branch}`;
}

async function getTree(adapter, wikiData) {
  const key = treeCacheKey(wikiData);
  if (!treeCache.has(key)) {
    treeCache.set(key, adapter.fetchTree(wikiData).then((r) => r.entries));
  }
  return treeCache.get(key);
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search the repository's full file tree by filename/path substring (case-insensitive). Use this to find files not covered by the wiki documentation before answering.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Substring to search for in file paths, e.g. 'router' or '.c'" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_file",
      description: "Fetch the raw text contents of a specific file in the repository (path exactly as returned by search_files).",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Exact file path within the repository" } },
        required: ["path"],
      },
    },
  },
];

async function executeTool(name, argsJson, adapter, wikiData) {
  let args;
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch (err) {
    return `Error: invalid arguments JSON for "${name}": ${err.message}`;
  }

  if (name === "search_files") {
    try {
      const entries = await getTree(adapter, wikiData);
      const q = (args.query || "").toLowerCase();
      const matches = entries.filter((e) => e.type === "blob" && e.path.toLowerCase().includes(q)).slice(0, MAX_SEARCH_RESULTS);
      if (matches.length === 0) return `No files found matching "${args.query}".`;
      return matches.map((e) => e.path).join("\n");
    } catch (err) {
      return `Error searching files: ${err.message}`;
    }
  }

  if (name === "fetch_file") {
    try {
      return await adapter.fetchRawFile(wikiData, args.path, MAX_FILE_FETCH_CHARS);
    } catch (err) {
      return `Error fetching "${args.path}": ${err.message}`;
    }
  }

  return `Error: unknown tool "${name}".`;
}

export function buildWikiContext(wikiData) {
  const pages = [...wikiData.pages].sort((a, b) => a.order - b.order);
  let context = "";
  for (const page of pages) {
    const block = `## ${page.title}\n\n${page.markdown}\n\n`;
    if (context.length + block.length > CONTEXT_BUDGET_CHARS) {
      context += "...[remaining pages omitted for length]";
      break;
    }
    context += block;
  }
  return context;
}

export async function askQuestion({ wikiData, question, history, settings }) {
  const adapter = getAdapterById(wikiData.providerId);
  const ref = { ...wikiData, token: getGitToken(wikiData.host) };
  const context = buildWikiContext(wikiData);
  const systemPrompt =
    `You are answering developer questions about the repository ${wikiData.owner}/${wikiData.repo} ` +
    `(host: ${wikiData.host}, branch: ${wikiData.branch}). Below is auto-generated wiki documentation for the repo. ` +
    `It may not cover everything — if a question needs detail the documentation doesn't have, use the search_files ` +
    `and fetch_file tools to look at the actual source before answering, rather than guessing.\n\n${context}`;

  const recentHistory = history.slice(-MAX_HISTORY_TURNS * 2).map((m) => ({ role: m.role, content: m.content }));
  const messages = [{ role: "system", content: systemPrompt }, ...recentHistory, { role: "user", content: question }];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const { content, toolCalls } = await chatCompletion({ ...settings, messages, tools: TOOLS, temperature: 0.3 });

    if (!toolCalls || toolCalls.length === 0) {
      return content;
    }

    messages.push({ role: "assistant", content: content || null, tool_calls: toolCalls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: tc.arguments } })) });

    for (const tc of toolCalls) {
      const result = adapter
        ? await executeTool(tc.name, tc.arguments, adapter, ref)
        : `Error: this wiki's repository host (${wikiData.providerId}) doesn't support live file lookups.`;
      messages.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
  }

  // Didn't converge within the tool-call budget — rather than dead-ending,
  // force a final answer from whatever's been gathered so far: one more call
  // with tools omitted entirely, so the model can't ask for another lookup
  // and must respond with text.
  messages.push({
    role: "user",
    content: "You've used up the available tool lookups for this question. Please give your best answer now based on everything gathered so far, noting any uncertainty.",
  });
  const { content } = await chatCompletion({ ...settings, messages, temperature: 0.3 });
  return content || "Couldn't reach a final answer within the available tool lookups — try rephrasing your question or asking something more specific.";
}
