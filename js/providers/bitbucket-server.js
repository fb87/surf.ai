import { providerFetch, probeReadme, truncateText } from "./common.js";

// Self-hosted Bitbucket Server / Data Center — REST API 1.0, structurally
// unrelated to Bitbucket Cloud's API 2.0. URLs use /projects/{KEY}/repos/{repo}
// rather than a flat workspace/repo path. Untested against a real instance
// (none available) — implemented per Atlassian's published REST docs. Most
// self-hosted instances require authentication even for nominally public
// repos, which this app doesn't support, and CORS is admin/version-dependent,
// so this is likely to fail outright on many real deployments; errors surface
// clearly rather than hanging.
export const id = "bitbucket-server";
export const label = "Bitbucket Server";

const PAGE_LIMIT = 1000;
const MAX_PAGES = 10;

// Fallback for standalone use without an explicit forcedHost (normal usage
// always goes through detect.js's resolveWithProvider, which supplies one).
function extractHostFallback(rest) {
  const m = rest.match(/^([^/]+)/);
  return m && m[1].includes(".") ? m[1] : null;
}

export function parseUrl(input, forcedHost) {
  const trimmed = input.trim();
  let rest = trimmed.replace(/^https?:\/\//, "");
  const host = forcedHost || extractHostFallback(rest);
  if (!host) throw new Error(`Couldn't determine the Bitbucket Server host from "${input}".`);
  const hostPrefix = `${host}/`;
  if (rest.startsWith(hostPrefix)) rest = rest.slice(hostPrefix.length);

  const m = rest.match(/projects\/([^/]+)\/repos\/([^/]+)/i);
  if (!m) throw new Error(`Couldn't parse a /projects/{KEY}/repos/{repo} path from "${input}".`);
  const [, owner, repo] = m;

  let branch = null;
  const atMatch = rest.match(/[?&]at=([^&]+)/);
  if (atMatch) branch = decodeURIComponent(atMatch[1]).replace(/^refs\/heads\//, "");

  return { host, owner, repo, branch };
}

function apiBase(host) {
  return `https://${host}/rest/api/1.0`;
}

export async function fetchDefaultBranch(ref) {
  const res = await providerFetch(`${apiBase(ref.host)}/projects/${ref.owner}/repos/${ref.repo}/branches/default`);
  const json = await res.json();
  return json.displayId;
}

export async function fetchTree(ref) {
  const entries = [];
  let start = 0;
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${apiBase(ref.host)}/projects/${ref.owner}/repos/${ref.repo}/files?at=${encodeURIComponent(ref.branch)}&limit=${PAGE_LIMIT}&start=${start}`;
    const res = await providerFetch(url);
    const json = await res.json();
    for (const path of json.values || []) {
      entries.push({ path, type: "blob", size: undefined });
    }
    if (json.isLastPage !== false) break;
    start = json.nextPageStart;
    if (page === MAX_PAGES - 1) truncated = true;
  }
  return { entries, truncated };
}

export async function fetchReadme(ref) {
  return probeReadme(fetchRawFile, ref);
}

export async function fetchRawFile(ref, path, maxChars = 50_000) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const res = await providerFetch(`${apiBase(ref.host)}/projects/${ref.owner}/repos/${ref.repo}/raw/${encodedPath}?at=${encodeURIComponent(ref.branch)}`);
  return truncateText(await res.text(), maxChars);
}
