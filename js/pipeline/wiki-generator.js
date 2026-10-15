import { classifyFiles, groupIntoModules, moduleSignature } from "../providers/repo-filter.js";
import { chatCompletion, getLlmProviderLabel } from "../llm/llm-client.js";
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

// Incremental update: reuses a prior run's per-module summaries for any
// module whose exact file set + content signatures (blob sha, or file size
// where sha isn't available — see repo-filter.js) are unchanged, so an
// "Update" only re-reads and re-summarizes what actually changed. Pass 2
// (synthesis) still runs on the merged summary set whenever anything did
// change, since the wiki pages are holistic documents — but if literally
// nothing changed (including the README), it's skipped entirely and the
// prior WikiData is returned as-is.
export async function generateWiki(adapter, repoMeta, settings, onProgress = () => {}, previousWikiData = null) {
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

    const prevManifestByName = new Map((previousWikiData?.moduleManifest || []).map((m) => [m.name, m]));

    onProgress({ phase: "pass1", owner: repoMeta.owner, repo: repoMeta.repo, moduleTotal: modules.length, moduleDone: 0 });

    let moduleDone = 0;
    let reusedCount = 0;
    const newManifest = [];
    const moduleSummaries = await runWithConcurrency(modules, 3, async (mod) => {
      const signature = moduleSignature(mod);
      const prev = prevManifestByName.get(mod.name);

      let summary;
      if (prev && prev.signature === signature) {
        summary = prev.summary;
        reusedCount++;
      } else {
        // Capped lower than module-level concurrency (3) would otherwise allow,
        // since raw.githubusercontent.com throttles bursts of concurrent
        // anonymous requests at the CDN level — up to 3*2=6 concurrent raw
        // fetches at once is gentler than the previous 3*4=12 while providerFetch's
        // retry-with-backoff (common.js) covers the rest.
        const filesWithContent = await runWithConcurrency(mod.files, 2, (f) => adapter.fetchRawFile(fullRef, f.path));
        const { messages } = buildModuleSummaryPrompt(mod, filesWithContent, fullRef);
        try {
          const { content } = await chatCompletion({ ...settings, messages });
          summary = validateModuleSummary(extractJson(content), mod.name);
        } catch (err) {
          summary = validateModuleSummary(null, mod.name);
        }
      }

      newManifest.push({ name: mod.name, signature, summary });
      moduleDone++;
      onProgress({
        phase: "pass1",
        owner: repoMeta.owner,
        repo: repoMeta.repo,
        moduleTotal: modules.length,
        moduleDone,
        moduleReused: reusedCount,
        moduleName: mod.name,
      });
      return summary;
    });

    const readmeUnchanged = previousWikiData && previousWikiData.readme === (readme || null);
    const moduleSetUnchanged =
      previousWikiData &&
      newManifest.length === prevManifestByName.size &&
      newManifest.every((m) => prevManifestByName.get(m.name)?.signature === m.signature);

    if (previousWikiData && readmeUnchanged && moduleSetUnchanged) {
      onProgress({ phase: "up-to-date", owner: repoMeta.owner, repo: repoMeta.repo });
      return {
        ...previousWikiData,
        llmProvider: previousWikiData.llmProvider || getLlmProviderLabel(settings.baseUrl),
        llmModel: previousWikiData.llmModel || settings.model,
        updateLlmProvider: getLlmProviderLabel(settings.baseUrl),
        updateLlmModel: settings.model,
        moduleManifest: newManifest,
        readme: readme || null,
        checked_at: new Date().toISOString(),
        unchanged: true,
      };
    }

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
      llmProvider: previousWikiData?.llmProvider || getLlmProviderLabel(settings.baseUrl),
      llmModel: previousWikiData?.llmModel || settings.model,
      ...(previousWikiData
        ? { updateLlmProvider: getLlmProviderLabel(settings.baseUrl), updateLlmModel: settings.model }
        : {}),
      host: repoMeta.host,
      owner: repoMeta.owner,
      repo: repoMeta.repo,
      branch,
      generated_at: new Date().toISOString(),
      checked_at: new Date().toISOString(),
      pages: wiki.pages,
      moduleManifest: newManifest,
      readme: readme || null,
      qaHistory: previousWikiData?.qaHistory || [],
    };
  } catch (err) {
    if (err instanceof WikiGenerationError) throw err;
    throw err; // ProviderApiError / LlmApiError pass through with their .kind intact
  }
}
