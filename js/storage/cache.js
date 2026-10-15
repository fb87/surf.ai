const SETTINGS_KEY = "wikigen.settings.v1";
const CONNECTIONS_KEY = "wikigen.connections.v1";
const MAX_CONNECTION_HISTORY = 20;
const INDEX_KEY = "wikigen.cache.v1.index";
const REPO_KEY_PREFIX = "wikigen.cache.v1.repo:";
const GIT_TOKENS_KEY = "wikigen.gittokens.v1";

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
  if (value.baseUrl && value.model) recordConnection(value);
  return value;
}

// ---- Connection history ----
// Remembers recently-used {baseUrl, apiKey, model} combos so switching
// between providers doesn't mean retyping a key each time.

function recordConnection({ baseUrl, apiKey, model }) {
  const list = listConnections().filter((c) => !(c.baseUrl === baseUrl && c.model === model));
  list.unshift({ baseUrl, apiKey, model, lastUsed: new Date().toISOString() });
  localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(list.slice(0, MAX_CONNECTION_HISTORY)));
}

export function listConnections() {
  try {
    const raw = localStorage.getItem(CONNECTIONS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function deleteConnection(baseUrl, model) {
  const list = listConnections().filter((c) => !(c.baseUrl === baseUrl && c.model === model));
  localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(list));
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

// ---- Git host access tokens ----
// Keyed by host (e.g. "github.com", "ghe.mycompany.com"), not by repo —
// unauthenticated access is rate-limited quite low (e.g. GitHub: 60/hr); an
// optional personal access token raises that substantially (GitHub: 5000/hr)
// and allows private repos where the host supports it. Never stored inside a
// cached WikiData — looked up fresh by host at request time.

export function getGitTokens() {
  try {
    const raw = localStorage.getItem(GIT_TOKENS_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

export function getGitToken(host) {
  if (!host) return undefined;
  return getGitTokens()[host.toLowerCase()];
}

export function saveGitToken(host, token) {
  const tokens = getGitTokens();
  if (token) tokens[host.toLowerCase()] = token;
  else delete tokens[host.toLowerCase()];
  localStorage.setItem(GIT_TOKENS_KEY, JSON.stringify(tokens));
}

export function deleteGitToken(host) {
  const tokens = getGitTokens();
  delete tokens[host.toLowerCase()];
  localStorage.setItem(GIT_TOKENS_KEY, JSON.stringify(tokens));
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
  const index = readIndex();
  // Self-heal: entries from before host/providerId were added to the cache
  // schema can never resolve under the current key format (which includes
  // host) — drop them from the index rather than surfacing a broken "Open".
  const valid = index.filter((e) => typeof e.host === "string" && e.host);
  if (valid.length !== index.length) writeIndex(valid);
  return valid.sort((a, b) => new Date(b.lastAccessed) - new Date(a.lastAccessed));
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
      llmProvider: wikiData.llmProvider,
      llmModel: wikiData.llmModel,
      updateLlmProvider: wikiData.updateLlmProvider,
      updateLlmModel: wikiData.updateLlmModel,
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

export function clearAllCachedWikis() {
  for (const entry of readIndex()) {
    localStorage.removeItem(entry.key);
  }
  writeIndex([]);
}

// Approximate bytes used, counted the way browsers typically do for
// localStorage quota purposes (UTF-16 code units, 2 bytes each) — there's no
// reliable cross-browser API to query the actual localStorage quota itself
// (it's commonly 5-10MB per origin, but varies), so this reports usage
// without claiming to know the exact ceiling.
export function getStorageUsage() {
  let wikiBytes = 0;
  const wikiIndex = readIndex();
  for (const entry of wikiIndex) {
    wikiBytes += entry.sizeBytes || 0;
  }

  let totalBytes = 0;
  for (const key of allAppKeys()) {
    const value = localStorage.getItem(key) || "";
    totalBytes += (key.length + value.length) * 2;
  }

  return { totalBytes, wikiBytes, wikiCount: wikiIndex.length };
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

// ---- Backup export/import ----
// Covers everything this app stores: settings, connection history, cached
// wikis + index, and theme. Stored/restored as raw strings (localStorage's
// native type), keyed by their actual localStorage key, so this stays valid
// regardless of how individual values' JSON shapes evolve over time.

const APP_KEY_PREFIX = "wikigen.";

function allAppKeys() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(APP_KEY_PREFIX)) keys.push(key);
  }
  return keys;
}

function redactApiKey(jsonString) {
  try {
    const obj = JSON.parse(jsonString);
    if (obj && typeof obj === "object" && "apiKey" in obj) obj.apiKey = "";
    return JSON.stringify(obj);
  } catch {
    return jsonString;
  }
}

function redactConnectionKeys(jsonString) {
  try {
    const list = JSON.parse(jsonString);
    if (Array.isArray(list)) {
      for (const c of list) {
        if (c && typeof c === "object") c.apiKey = "";
      }
    }
    return JSON.stringify(list);
  } catch {
    return jsonString;
  }
}

function redactGitTokens(jsonString) {
  try {
    const tokens = JSON.parse(jsonString);
    if (tokens && typeof tokens === "object") {
      for (const host of Object.keys(tokens)) tokens[host] = "";
    }
    return JSON.stringify(tokens);
  } catch {
    return jsonString;
  }
}

export function exportAllData({ includeApiKeys = true } = {}) {
  const data = {};
  for (const key of allAppKeys()) {
    let value = localStorage.getItem(key);
    if (!includeApiKeys) {
      if (key === SETTINGS_KEY) value = redactApiKey(value);
      else if (key === CONNECTIONS_KEY) value = redactConnectionKeys(value);
      else if (key === GIT_TOKENS_KEY) value = redactGitTokens(value);
    }
    data[key] = value;
  }
  return { version: 1, exportedAt: new Date().toISOString(), data };
}

// Full restore, not a merge: existing app data is cleared first so the
// result exactly matches the backup rather than a mix of old and new.
export function importAllData(payload) {
  if (!payload || typeof payload !== "object" || typeof payload.data !== "object" || payload.data === null) {
    throw new Error("That doesn't look like a surf.ai backup file.");
  }

  for (const key of allAppKeys()) localStorage.removeItem(key);

  let count = 0;
  for (const [key, value] of Object.entries(payload.data)) {
    if (typeof key !== "string" || !key.startsWith(APP_KEY_PREFIX)) continue;
    if (typeof value !== "string") continue;
    localStorage.setItem(key, value);
    count++;
  }
  return count;
}
