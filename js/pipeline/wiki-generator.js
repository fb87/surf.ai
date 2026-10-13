import { classifyFiles, groupIntoModules } from "../providers/repo-filter.js";
import { chatCompletion } from "../llm/llm-client.js";
import { buildModuleSummaryPrompt, buildTreeOutline, buildSynthesisPrompt } from "./prompts.js";
import { extractJson, validateModuleSummary, validateWikiStructure } from "./schema.js";
import { runWithConcurrency } from "../utils/concurrency.js";

const SYNTHESIS_BUDGET_CHARS = 48_000;
const README_BUDGET_CHARS = 6_000;
const TREE_OUTLINE_BUDGET_CHARS = 4_000;

export class WikiGenerationError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "WikiGenerationError";
    this.cause = cause;
  }
}

function truncate(text, maxChars) {
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + `\n...[truncated]`;
}

function buildSynthesisInput(readme, treeOutline, moduleSummaries) {
  const readmeTrunc = truncate(readme, README_BUDGET_CHARS);
  const treeTrunc = truncate(treeOutline, TREE_OUTLINE_BUDGET_CHARS);
  let budgetForModules = SYNTHESIS_BUDGET_CHARS - readmeTrunc.length - treeTrunc.length;

  const ranked = [...moduleSummaries]; // already in a reasonable order (by module size, via groupIntoModules)
  const included = [];
  const omitted = [];
  let used = 0;

  for (const summary of ranked) {
    const size = JSON.stringify(summary).length;
    if (used + size <= budgetForModules || included.length === 0) {
      included.push(summary);
      used += size;
    } else {
      omitted.push(summary.module);
    }
  }

  return { readme: readmeTrunc, treeOutline: treeTrunc, moduleSummaries: included, omittedModules: omitted };
}

export async function generateWiki(adapter, repoMeta, settings, onProgress = () => {}) {
  try {
    onProgress({ phase: "fetching-tree", owner: repoMeta.owner, repo: repoMeta.repo });

    const branch = repoMeta.branch || (await adapter.fetchDefaultBranch(repoMeta));
    const fullRef = { ...repoMeta, branch };
    const { entries } = await adapter.fetchTree(fullRef);
    const readme = await adapter.fetchReadme(fullRef);

    const filtered = classifyFiles(entries);
    const modules = groupIntoModules(filtered);

    if (modules.length === 0) {
      throw new WikiGenerationError("No usable source files were found in this repository after filtering.");
    }

    onProgress({ phase: "pass1", owner: repoMeta.owner, repo: repoMeta.repo, moduleTotal: modules.length, moduleDone: 0 });

    let moduleDone = 0;
    const moduleSummaries = await runWithConcurrency(modules, 3, async (mod) => {
      const filesWithContent = await runWithConcurrency(mod.files, 4, (f) =>
        adapter.fetchRawFile(fullRef, f.path)
      );
      const { messages } = buildModuleSummaryPrompt(mod, filesWithContent, fullRef);
      let summary;
      try {
        const { content } = await chatCompletion({ ...settings, messages });
        summary = validateModuleSummary(extractJson(content), mod.name);
      } catch (err) {
        summary = validateModuleSummary(null, mod.name);
      }
      moduleDone++;
      onProgress({
        phase: "pass1",
        owner: repoMeta.owner,
        repo: repoMeta.repo,
        moduleTotal: modules.length,
        moduleDone,
        moduleName: mod.name,
      });
      return summary;
    });

    onProgress({ phase: "pass2", owner: repoMeta.owner, repo: repoMeta.repo });

    const treeOutline = buildTreeOutline(entries);
    const synthInput = buildSynthesisInput(readme, treeOutline, moduleSummaries);
    const { messages: synthMessages } = buildSynthesisPrompt(synthInput, fullRef);

    const { content } = await chatCompletion({
      ...settings,
      messages: synthMessages,
      responseFormat: { type: "json_object" },
    });

    let wiki;
    try {
      wiki = validateWikiStructure(extractJson(content));
    } catch (err) {
      throw new WikiGenerationError(
        "The model's response couldn't be parsed as a valid wiki structure. Try Regenerate, or switch models.",
        err
      );
    }

    return {
      providerId: repoMeta.providerId,
      host: repoMeta.host,
      owner: repoMeta.owner,
      repo: repoMeta.repo,
      branch,
      generated_at: new Date().toISOString(),
      pages: wiki.pages,
    };
  } catch (err) {
    if (err instanceof WikiGenerationError) throw err;
    throw err; // ProviderApiError / LlmApiError pass through with their .kind intact
  }
}
