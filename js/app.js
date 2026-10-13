import { getState, setState, subscribe } from "./state.js";
import { getSettings, isSettingsValid, saveCachedWiki, getCachedWiki, listCachedRepos, getTheme, saveTheme } from "./storage/cache.js";
import { openSettings } from "./views/settings-modal.js";
import { mountLandingView } from "./views/landing-view.js";
import { mountProgressView, mountProgressError } from "./views/progress-view.js";
import { mountWikiView } from "./views/wiki-view.js";
import { parseRepoUrl } from "./github/github-client.js";
import { generateWiki } from "./pipeline/wiki-generator.js";
import { clear } from "./utils/dom.js";
import { mapErrorToMessage } from "./utils/errors.js";

const viewRoot = document.getElementById("view-root");

function initTheme() {
  const saved = getTheme();
  if (saved === "dark" || saved === "light") {
    document.documentElement.setAttribute("data-theme", saved);
  }
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const effectiveCurrent = current || (prefersDark ? "dark" : "light");
    const next = effectiveCurrent === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    saveTheme(next);
  });
}

async function runGeneration(repoMeta, { bypassCache } = {}) {
  if (!bypassCache) {
    let branchForLookup = repoMeta.branch;
    if (!branchForLookup) {
      const match = listCachedRepos().find(
        (e) => e.owner.toLowerCase() === repoMeta.owner.toLowerCase() && e.repo.toLowerCase() === repoMeta.repo.toLowerCase()
      );
      if (match) branchForLookup = match.branch;
    }
    if (branchForLookup) {
      const cached = getCachedWiki(repoMeta.owner, repoMeta.repo, branchForLookup);
      if (cached) {
        setState({ view: "wiki", wiki: cached, wikiActivePageId: cached.pages[0]?.id || null });
        return;
      }
    }
  }

  setState({
    view: "progress",
    progress: { phase: "fetching-tree", owner: repoMeta.owner, repo: repoMeta.repo },
    error: null,
  });

  const settings = getSettings();
  try {
    const wiki = await generateWiki(repoMeta, settings, (progress) => {
      setState({ progress });
    });
    const saveResult = saveCachedWiki(wiki);
    if (!saveResult.ok) {
      console.warn("Could not cache wiki:", saveResult.reason);
    }
    setState({ view: "wiki", wiki, wikiActivePageId: wiki.pages[0]?.id || null });
  } catch (err) {
    console.error(err);
    setState({ view: "error", error: { message: mapErrorToMessage(err) } });
  }
}

function handleGenerateRepo(rawInput) {
  let repoMeta;
  try {
    repoMeta = parseRepoUrl(rawInput);
  } catch (err) {
    setState({ view: "error", error: { message: err.message } });
    return;
  }

  const settings = getSettings();
  if (!isSettingsValid(settings)) {
    openSettings({
      notice: "Configure your API connection to generate a wiki.",
      onSaved: () => runGeneration(repoMeta),
    });
    return;
  }

  runGeneration(repoMeta);
}

function render() {
  const state = getState();
  clear(viewRoot);

  if (state.view === "landing") {
    mountLandingView(viewRoot, { onGenerateRepo: handleGenerateRepo });
  } else if (state.view === "progress") {
    mountProgressView(viewRoot, state.progress);
  } else if (state.view === "error") {
    mountProgressError(viewRoot, state.error.message, {
      onBack: () => setState({ view: "landing", error: null }),
    });
  } else if (state.view === "wiki") {
    mountWikiView(viewRoot, state.wiki, state.wikiActivePageId, {
      onBack: () => setState({ view: "landing" }),
      onRegenerate: () => {
        if (!confirm(`Regenerate the wiki for ${state.wiki.owner}/${state.wiki.repo}? This will overwrite the cached version.`)) return;
        runGeneration({ owner: state.wiki.owner, repo: state.wiki.repo, branch: state.wiki.branch }, { bypassCache: true });
      },
    });
  }
}

subscribe(render);
initTheme();
render();
