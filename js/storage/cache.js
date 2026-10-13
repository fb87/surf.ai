const SETTINGS_KEY = "wikigen.settings.v1";
const INDEX_KEY = "wikigen.cache.v1.index";
const REPO_KEY_PREFIX = "wikigen.cache.v1.repo:";

function repoKey(host, owner, repo, branch) {
  return `${REPO_KEY_PREFIX}${host.toLowerCase()}/${owner.toLowerCase()}/${repo.toLowerCase()}/${branch}`;
}

function sameRepo(entry, host, owner, repo, branch) {
  return (
    entry.host.toLowerCase() === host.toLowerCase() &&
    entry.owner.toLowerCase() === owner.toLowerCase() &&
    entry.repo.toLowerCase() === repo.toLowerCase() &&
    entry.branch === branch
  );
}

// ---- Settings ----

export function getSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.baseUrl || !parsed.model) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSettings(settings) {
  const value = { ...settings, updatedAt: new Date().toISOString() };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
  return value;
}

export function isSettingsValid(settings) {
  if (!settings) return false;
  if (!settings.baseUrl || !settings.model) return false;
  try {
    new URL(settings.baseUrl);
  } catch {
    return false;
  }
  return true;
}

// ---- Wiki cache ----

function readIndex() {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeIndex(index) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

export function listCachedRepos() {
  return readIndex().sort((a, b) => new Date(b.lastAccessed) - new Date(a.lastAccessed));
}

export function getCachedWiki(host, owner, repo, branch) {
  try {
    const raw = localStorage.getItem(repoKey(host, owner, repo, branch));
    if (!raw) return null;
    const wiki = JSON.parse(raw);
    touchIndexEntry(host, owner, repo, branch);
    return wiki;
  } catch {
    return null;
  }
}

function touchIndexEntry(host, owner, repo, branch) {
  const index = readIndex();
  const entry = index.find((e) => sameRepo(e, host, owner, repo, branch));
  if (entry) {
    entry.lastAccessed = new Date().toISOString();
    writeIndex(index);
  }
}

export function saveCachedWiki(wikiData) {
  const key = repoKey(wikiData.host, wikiData.owner, wikiData.repo, wikiData.branch);
  const serialized = JSON.stringify(wikiData);

  const attemptSave = () => {
    localStorage.setItem(key, serialized);
    let index = readIndex().filter((e) => !sameRepo(e, wikiData.host, wikiData.owner, wikiData.repo, wikiData.branch));
    index.push({
      key,
      providerId: wikiData.providerId,
      host: wikiData.host,
      owner: wikiData.owner,
      repo: wikiData.repo,
      branch: wikiData.branch,
      generatedAt: wikiData.generated_at,
      sizeBytes: serialized.length,
      lastAccessed: new Date().toISOString(),
    });
    writeIndex(index);
  };

  try {
    attemptSave();
    return { ok: true };
  } catch (err) {
    if (!(err instanceof DOMException && err.name === "QuotaExceededError")) {
      return { ok: false, reason: err.message };
    }
    // Evict least-recently-accessed entries until it fits or nothing is left to evict.
    let index = readIndex().sort((a, b) => new Date(a.lastAccessed) - new Date(b.lastAccessed));
    while (index.length > 0) {
      const victim = index.shift();
      if (victim.key === key) continue; // don't evict the thing we're trying to save
      try {
        localStorage.removeItem(victim.key);
      } catch {
        /* ignore */
      }
      writeIndex(index);
      try {
        attemptSave();
        return { ok: true, evicted: true };
      } catch (err2) {
        if (!(err2 instanceof DOMException && err2.name === "QuotaExceededError")) {
          return { ok: false, reason: err2.message };
        }
        // keep evicting
      }
    }
    return { ok: false, reason: "localStorage quota exceeded and no cache entries left to evict" };
  }
}

export function deleteCachedWiki(host, owner, repo, branch) {
  localStorage.removeItem(repoKey(host, owner, repo, branch));
  const index = readIndex().filter((e) => !sameRepo(e, host, owner, repo, branch));
  writeIndex(index);
}

// ---- Theme preference ----

export function getTheme() {
  try {
    return localStorage.getItem("wikigen.theme");
  } catch {
    return null;
  }
}

export function saveTheme(theme) {
  try {
    localStorage.setItem("wikigen.theme", theme);
  } catch {
    /* ignore */
  }
}
