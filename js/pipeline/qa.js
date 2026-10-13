import { chatCompletion } from "../llm/llm-client.js";

const CONTEXT_BUDGET_CHARS = 40_000;
const MAX_HISTORY_TURNS = 6;

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
    `(branch: ${wikiData.branch}). Use the following auto-generated wiki documentation as your source of truth. ` +
    `If it doesn't cover something, say so rather than guessing.\n\n${context}`;

  const recentHistory = history.slice(-MAX_HISTORY_TURNS * 2).map((m) => ({ role: m.role, content: m.content }));

  const messages = [{ role: "system", content: systemPrompt }, ...recentHistory, { role: "user", content: question }];

  const { content } = await chatCompletion({ ...settings, messages, temperature: 0.3 });
  return content;
}
