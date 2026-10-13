import { chatCompletion } from "../llm/llm-client.js";
import { fetchTree, fetchRawFile } from "../github/github-client.js";

const CONTEXT_BUDGET_CHARS = 40_000;
const MAX_HISTORY_TURNS = 6;
const MAX_TOOL_ITERATIONS = 5;
const MAX_SEARCH_RESULTS = 30;
const MAX_FILE_FETCH_CHARS = 20_000;

const treeCache = new Map(); // "owner/repo/branch" -> Promise<TreeEntry[]>

function treeCacheKey(wikiData) {
  return `${wikiData.owner.toLowerCase()}/${wikiData.repo.toLowerCase()}/${wikiData.branch}`;
}

async function getTree(wikiData) {
  const key = treeCacheKey(wikiData);
  if (!treeCache.has(key)) {
    treeCache.set(
      key,
      fetchTree(wikiData.owner, wikiData.repo, wikiData.branch).then((r) => r.entries)
    );
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

async function executeTool(name, argsJson, wikiData) {
  let args;
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch (err) {
    return `Error: invalid arguments JSON for "${name}": ${err.message}`;
  }

  if (name === "search_files") {
    try {
      const entries = await getTree(wikiData);
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
      return await fetchRawFile(wikiData.owner, wikiData.repo, wikiData.branch, args.path, MAX_FILE_FETCH_CHARS);
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
  const context = buildWikiContext(wikiData);
  const systemPrompt =
    `You are answering developer questions about the GitHub repository ${wikiData.owner}/${wikiData.repo} ` +
    `(branch: ${wikiData.branch}). Below is auto-generated wiki documentation for the repo. It may not cover ` +
    `everything — if a question needs detail the documentation doesn't have, use the search_files and fetch_file ` +
    `tools to look at the actual source before answering, rather than guessing.\n\n${context}`;

  const recentHistory = history.slice(-MAX_HISTORY_TURNS * 2).map((m) => ({ role: m.role, content: m.content }));
  const messages = [{ role: "system", content: systemPrompt }, ...recentHistory, { role: "user", content: question }];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const { content, toolCalls } = await chatCompletion({ ...settings, messages, tools: TOOLS, temperature: 0.3 });

    if (!toolCalls || toolCalls.length === 0) {
      return content;
    }

    messages.push({ role: "assistant", content: content || null, tool_calls: toolCalls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: tc.arguments } })) });

    for (const tc of toolCalls) {
      const result = await executeTool(tc.name, tc.arguments, wikiData);
      messages.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
  }

  throw new Error("Reached the maximum number of tool lookups without a final answer. Try rephrasing your question.");
}
