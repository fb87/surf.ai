import { providerFetch, probeReadme, truncateText } from "./common.js";

// Covers both gitlab.com and self-hosted GitLab (same v4 REST API, different
// host). Only top-level `owner/repo` projects are supported — GitLab's nested
// subgroups (group/subgroup/project) aren't handled, to keep the owner/repo
// identity model consistent with every other provider in this app.
export const id = "gitlab";
export const label = "GitLab";

const MAX_TREE_PAGES = 10;
const PER_PAGE = 100;

const DEFAULT_HOST = "gitlab.com";

export function parseUrl(input, forcedHost) {
  const trimmed = input.trim();
  let rest = trimmed.replace(/^https?:\/\//, "");
  const host = forcedHost || DEFAULT_HOST;
  const hostPrefix = `${host}/`;
  if (rest.startsWith(hostPrefix)) rest = rest.slice(hostPrefix.length);
  else if (rest === host) rest = "";
  rest = rest.replace(/\.git$/, "").replace(/\/+$/, "");

  const dashIdx = rest.indexOf("/-/");
  const pathPart = dashIdx === -1 ? rest : rest.slice(0, dashIdx);
  const afterDash = dashIdx === -1 ? "" : rest.slice(dashIdx + 3);

  const parts = pathPart.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error(`Couldn't parse an owner/repo from "${input}".`);
  const [owner, repo] = parts;

  let branch = null;
  const afterParts = afterDash.split("/").filter(Boolean);
  if ((afterParts[0] === "tree" || afterParts[0] === "blob") && afterParts[1]) {
    branch = afterParts.slice(1).join("/");
  }

  return { host, owner, repo, branch };
}

function projectPath(ref) {
  return encodeURIComponent(`${ref.owner}/${ref.repo}`);
}

function apiBase(host) {
  return `https://${host}/api/v4`;
}

export async function fetchDefaultBranch(ref) {
  const res = await providerFetch(`${apiBase(ref.host)}/projects/${projectPath(ref)}`);
  const json = await res.json();
  return json.default_branch;
}

export async function fetchTree(ref) {
  const entries = [];
  let truncated = false;
  for (let page = 1; page <= MAX_TREE_PAGES; page++) {
    const url = `${apiBase(ref.host)}/projects/${projectPath(ref)}/repository/tree?recursive=true&ref=${encodeURIComponent(ref.branch)}&per_page=${PER_PAGE}&page=${page}`;
    const res = await providerFetch(url);
    const batch = await res.json();
    for (const e of batch) {
      entries.push({ path: e.path, type: e.type === "tree" ? "tree" : "blob", size: undefined });
    }
    if (batch.length < PER_PAGE) break;
    if (page === MAX_TREE_PAGES) truncated = true;
  }
  return { entries, truncated };
}

export async function fetchReadme(ref) {
  return probeReadme(fetchRawFile, ref);
}

export async function fetchRawFile(ref, path, maxChars = 50_000) {
  const encodedPath = encodeURIComponent(path);
  const res = await providerFetch(`${apiBase(ref.host)}/projects/${projectPath(ref)}/repository/files/${encodedPath}/raw?ref=${encodeURIComponent(ref.branch)}`);
  return truncateText(await res.text(), maxChars);
}
