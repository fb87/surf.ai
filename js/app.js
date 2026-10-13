import { getState, setState, subscribe } from "./state.js";
import { getSettings, isSettingsValid, saveCachedWiki, getCachedWiki, listCachedRepos, getTheme, saveTheme } from "./storage/cache.js";
import { openSettings } from "./views/settings-modal.js";
import { openProviderPicker } from "./views/provider-picker-modal.js";
import { mountLandingView } from "./views/landing-view.js";
import { mountProgressView, mountProgressError } from "./views/progress-view.js";
import { mountWikiView } from "./views/wiki-view.js";
import { resolveProvider, resolveWithProvider, getAdapterById } from "./providers/detect.js";
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

async function runGeneration(adapter, repoMeta, { bypassCache, previousWikiData } = {}) {
  if (!bypassCache) {
    let branchForLookup = repoMeta.branch;
    if (!branchForLookup) {
      const match = listCachedRepos().find(
        (e) =>
          e.host.toLowerCase() === repoMeta.host.toLowerCase() &&
          e.owner.toLowerCase() === repoMeta.owner.toLowerCase() &&
          e.repo.toLowerCase() === repoMeta.repo.toLowerCase()
      );
      if (match) branchForLookup = match.branch;
    }
    if (branchForLookup) {
      const cached = getCachedWiki(repoMeta.host, repoMeta.owner, repoMeta.repo, branchForLookup);
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
    const wiki = await generateWiki(
      adapter,
      repoMeta,
      settings,
      (progress) => setState({ progress }),
      previousWikiData
    );
    const saveResult = saveCachedWiki(wiki);
    if (!saveResult.ok) {
      console.warn("Could not cache wiki:", saveResult.reason);
    }
    if (wiki.unchanged) {
      const reused = wiki.moduleManifest?.length ?? 0;
      alert(`No changes detected in ${repoMeta.owner}/${repoMeta.repo} — all ${reused} module${reused === 1 ? "" : "s"} unchanged since the last update.`);
    }
    setState({ view: "wiki", wiki, wikiActivePageId: wiki.pages[0]?.id || null });
  } catch (err) {
    console.error(err);
    setState({ view: "error", error: { message: mapErrorToMessage(err) } });
  }
}

function proceedWithRepo(adapter, ref) {
  const repoMeta = { ...ref, providerId: adapter.id };
  const settings = getSettings();
  if (!isSettingsValid(settings)) {
    openSettings({
      notice: "Configure your API connection to generate a wiki.",
      onSaved: () => runGeneration(adapter, repoMeta),
    });
    return;
  }
  runGeneration(adapter, repoMeta);
}

function handleGenerateRepo(rawInput) {
  let resolved;
  try {
    resolved = resolveProvider(rawInput);
  } catch (err) {
    setState({ view: "error", error: { message: err.message } });
    return;
  }

  if (resolved.needsProviderSelection) {
    openProviderPicker({
      host: resolved.host,
      onSelect: (providerId) => {
        try {
          const r = resolveWithProvider(rawInput, providerId);
          proceedWithRepo(r.adapter, r.ref);
        } catch (err) {
          setState({ view: "error", error: { message: err.message } });
        }
      },
    });
    return;
  }

  proceedWithRepo(resolved.adapter, resolved.ref);
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
      onUpdate: () => {
        const adapter = getAdapterById(state.wiki.providerId);
        if (!adapter) {
          setState({ view: "error", error: { message: `Unknown provider "${state.wiki.providerId}" — can't update this wiki.` } });
          return;
        }
        runGeneration(
          adapter,
          { host: state.wiki.host, owner: state.wiki.owner, repo: state.wiki.repo, branch: state.wiki.branch, providerId: state.wiki.providerId },
          { bypassCache: true, previousWikiData: state.wiki }
        );
      },
      onFullRebuild: () => {
        if (!confirm(`Fully rebuild the wiki for ${state.wiki.owner}/${state.wiki.repo} from scratch, re-reading and re-summarizing every module? This overwrites the cached version.`)) return;
        const adapter = getAdapterById(state.wiki.providerId);
        if (!adapter) {
          setState({ view: "error", error: { message: `Unknown provider "${state.wiki.providerId}" — can't rebuild this wiki.` } });
          return;
        }
        runGeneration(
          adapter,
          { host: state.wiki.host, owner: state.wiki.owner, repo: state.wiki.repo, branch: state.wiki.branch, providerId: state.wiki.providerId },
          { bypassCache: true }
        );
      },
    });
  }
}

subscribe(render);
initTheme();
render();
