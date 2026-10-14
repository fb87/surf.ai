import { providerFetch, normalizeHost, truncateText } from "./common.js";
import { ProviderApiError } from "./provider-error.js";

// Covers both github.com and GitHub Enterprise Server (custom domain). Same
// API shape either way, just a different base: github.com uses api.github.com
// + raw.githubusercontent.com, while GHES serves its API under /api/v3 on the
// same host and has no separate raw CDN, so file content goes through the
// Contents API with a raw-media-type Accept header instead.
export const id = "github";
export const label = "GitHub";

const DEFAULT_HOST = "github.com";

export function parseUrl(input, forcedHost) {
  const trimmed = input.trim();
  let rest = trimmed.replace(/^https?:\/\//, "");
  const host = forcedHost || DEFAULT_HOST;
  const hostPrefix = `${host}/`;
  if (rest.startsWith(hostPrefix)) rest = rest.slice(hostPrefix.length);
  else if (rest === host) rest = "";
  rest = rest.replace(/\.git$/, "").replace(/\/+$/, "");

  const parts = rest.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error(`Couldn't parse an owner/repo from "${input}".`);

  const [owner, repo] = parts;
  let branch = null;
  const treeIdx = parts.indexOf("tree");
  if (treeIdx !== -1 && parts[treeIdx + 1]) branch = parts.slice(treeIdx + 1).join("/");

  return { host, owner, repo, branch };
}

function isGithubCom(host) {
  return host === "github.com";
}

function apiBase(host) {
  return isGithubCom(host) ? "https://api.github.com" : `https://${host}/api/v3`;
}

// Only applied to api.github.com/GHES calls. raw.githubusercontent.com is a
// separate CDN with its own (much higher, effectively unauthenticated-only)
// limits — a token doesn't help there and private-repo content isn't served
// from it anyway, so there's nothing to gain by sending auth to that host.
function authHeaders(ref) {
  return ref.token ? { Authorization: `Bearer ${ref.token}` } : {};
}

export async function fetchDefaultBranch(ref) {
  const res = await providerFetch(`${apiBase(ref.host)}/repos/${ref.owner}/${ref.repo}`, { headers: authHeaders(ref) });
  const json = await res.json();
  return json.default_branch;
}

export async function fetchTree(ref) {
  const res = await providerFetch(`${apiBase(ref.host)}/repos/${ref.owner}/${ref.repo}/git/trees/${encodeURIComponent(ref.branch)}?recursive=1`, {
    headers: authHeaders(ref),
  });
  const json = await res.json();
  const entries = (json.tree || []).map((e) => ({ path: e.path, type: e.type, size: e.size, sha: e.sha }));
  return { entries, truncated: Boolean(json.truncated) };
}

export async function fetchReadme(ref) {
  const res = await providerFetch(`${apiBase(ref.host)}/repos/${ref.owner}/${ref.repo}/readme?ref=${encodeURIComponent(ref.branch)}`, {
    headers: { Accept: "application/vnd.github.raw", ...authHeaders(ref) },
    accept404: true,
  });
  if (!res) return null;
  return res.text();
}

export async function fetchRawFile(ref, path, maxChars = 50_000) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");

  if (isGithubCom(ref.host)) {
    const res = await providerFetch(`https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${encodeURIComponent(ref.branch)}/${encodedPath}`);
    return truncateText(await res.text(), maxChars);
  }

  const res = await providerFetch(`${apiBase(ref.host)}/repos/${ref.owner}/${ref.repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref.branch)}`, {
    headers: { Accept: "application/vnd.github.raw", ...authHeaders(ref) },
  });
  return truncateText(await res.text(), maxChars);
}
