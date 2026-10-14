import { providerFetch, probeReadme, truncateText } from "./common.js";

// gitee.com — API v5 is deliberately modeled after GitHub's API, so this
// adapter closely mirrors github.js. File content comes back base64-encoded
// via the contents endpoint rather than a separate raw CDN.
export const id = "gitee";
export const label = "Gitee";

export function parseUrl(input) {
  const trimmed = input.trim();
  let rest = trimmed.replace(/^https?:\/\//, "").replace(/^gitee\.com\//, "");
  rest = rest.replace(/\.git$/, "").replace(/\/+$/, "");

  const parts = rest.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error(`Couldn't parse an owner/repo from "${input}".`);
  const [owner, repo] = parts;

  let branch = null;
  const treeIdx = parts.indexOf("tree");
  if (treeIdx !== -1 && parts[treeIdx + 1]) branch = parts.slice(treeIdx + 1).join("/");

  return { host: "gitee.com", owner, repo, branch };
}

function apiBase() {
  return "https://gitee.com/api/v5";
}

function decodeBase64Utf8(b64) {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

function authHeaders(ref) {
  return ref.token ? { Authorization: `token ${ref.token}` } : {};
}

export async function fetchDefaultBranch(ref) {
  const res = await providerFetch(`${apiBase()}/repos/${ref.owner}/${ref.repo}`, { headers: authHeaders(ref) });
  const json = await res.json();
  return json.default_branch;
}

export async function fetchTree(ref) {
  const res = await providerFetch(`${apiBase()}/repos/${ref.owner}/${ref.repo}/git/trees/${encodeURIComponent(ref.branch)}?recursive=1`, {
    headers: authHeaders(ref),
  });
  const json = await res.json();
  const entries = (json.tree || []).map((e) => ({ path: e.path, type: e.type, size: e.size, sha: e.sha }));
  return { entries, truncated: Boolean(json.truncated) };
}

export async function fetchReadme(ref) {
  return probeReadme(fetchRawFile, ref);
}

export async function fetchRawFile(ref, path, maxChars = 50_000) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const res = await providerFetch(`${apiBase()}/repos/${ref.owner}/${ref.repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref.branch)}`, {
    headers: authHeaders(ref),
  });
  const json = await res.json();
  if (typeof json.content !== "string") throw new Error(`Unexpected response fetching ${path} from Gitee.`);
  return truncateText(decodeBase64Utf8(json.content), maxChars);
}
