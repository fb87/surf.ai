import { providerFetch, probeReadme, truncateText } from "./common.js";

// bitbucket.org only (REST API 2.0). Bitbucket Server/Data Center is a
// separate, incompatible API — see bitbucket-server.js.
export const id = "bitbucket-cloud";
export const label = "Bitbucket";

const MAX_DIR_CALLS = 60;
const PAGELEN = 100;

export function parseUrl(input) {
  const trimmed = input.trim();
  let rest = trimmed.replace(/^https?:\/\//, "").replace(/^bitbucket\.org\//, "");
  rest = rest.replace(/\.git$/, "").replace(/\/+$/, "");

  const srcIdx = rest.indexOf("/src/");
  const pathPart = srcIdx === -1 ? rest : rest.slice(0, srcIdx);
  const afterSrc = srcIdx === -1 ? "" : rest.slice(srcIdx + 5);

  const parts = pathPart.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error(`Couldn't parse a workspace/repo from "${input}".`);
  const [owner, repo] = parts;

  let branch = null;
  if (afterSrc) branch = afterSrc.split("/")[0];

  return { host: "bitbucket.org", owner, repo, branch };
}

function apiBase() {
  return "https://api.bitbucket.org/2.0";
}

// Bitbucket Cloud accepts an Atlassian API token (or App Password) as a
// Bearer token on its REST API.
function authHeaders(ref) {
  return ref.token ? { Authorization: `Bearer ${ref.token}` } : {};
}

export async function fetchDefaultBranch(ref) {
  const res = await providerFetch(`${apiBase()}/repositories/${ref.owner}/${ref.repo}`, { headers: authHeaders(ref) });
  const json = await res.json();
  return json.mainbranch?.name;
}

export async function fetchTree(ref) {
  const entries = [];
  let truncated = false;
  let dirCalls = 0;
  const queue = [""];

  while (queue.length > 0 && dirCalls < MAX_DIR_CALLS) {
    const dir = queue.shift();
    let url = `${apiBase()}/repositories/${ref.owner}/${ref.repo}/src/${encodeURIComponent(ref.branch)}/${dir}?pagelen=${PAGELEN}`;

    while (url && dirCalls < MAX_DIR_CALLS) {
      dirCalls++;
      const res = await providerFetch(url, { headers: authHeaders(ref) });
      const json = await res.json();
      for (const e of json.values || []) {
        if (e.type === "commit_directory") {
          entries.push({ path: e.path, type: "tree", size: undefined });
          queue.push(e.path);
        } else if (e.type === "commit_file") {
          entries.push({ path: e.path, type: "blob", size: e.size });
        }
      }
      url = json.next || null;
    }
  }
  if (queue.length > 0 || dirCalls >= MAX_DIR_CALLS) truncated = true;

  return { entries, truncated };
}

export async function fetchReadme(ref) {
  return probeReadme(fetchRawFile, ref);
}

export async function fetchRawFile(ref, path, maxChars = 50_000) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const res = await providerFetch(`${apiBase()}/repositories/${ref.owner}/${ref.repo}/src/${encodeURIComponent(ref.branch)}/${encodedPath}`, {
    headers: authHeaders(ref),
  });
  return truncateText(await res.text(), maxChars);
}
