export class GitHubApiError extends Error {
  constructor(message, kind, status) {
    super(message);
    this.name = "GitHubApiError";
    this.kind = kind; // 'not_found' | 'rate_limited' | 'network' | 'unknown'
    this.status = status;
  }
}

export function parseRepoUrl(input) {
  const trimmed = input.trim();
  // Accept: "owner/repo", "github.com/owner/repo", "https://github.com/owner/repo",
  // "https://github.com/owner/repo/tree/branch", optionally with trailing slash / .git
  let rest = trimmed.replace(/^https?:\/\//, "").replace(/^github\.com\//, "");
  rest = rest.replace(/\.git$/, "").replace(/\/+$/, "");
  const parts = rest.split("/").filter(Boolean);

  if (parts.length < 2) {
    throw new Error(`Couldn't parse a GitHub owner/repo from "${input}".`);
  }

  const [owner, repo] = parts;
  let branch = null;
  const treeIdx = parts.indexOf("tree");
  if (treeIdx !== -1 && parts[treeIdx + 1]) {
    branch = parts.slice(treeIdx + 1).join("/");
  }

  if (!owner || !repo) {
    throw new Error(`Couldn't parse a GitHub owner/repo from "${input}".`);
  }

  return { owner, repo, branch };
}

async function githubFetch(url, { accept } = {}) {
  let res;
  try {
    res = await fetch(url, { headers: accept ? { Accept: accept } : {} });
  } catch (err) {
    throw new GitHubApiError(`Network error reaching GitHub: ${err.message}`, "network");
  }

  if (res.status === 404) {
    throw new GitHubApiError("Repository or branch not found on GitHub.", "not_found", 404);
  }
  if (res.status === 403) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining === "0") {
      throw new GitHubApiError(
        "GitHub API rate limit exceeded (60 requests/hour for unauthenticated access). Wait and try again.",
        "rate_limited",
        403
      );
    }
    throw new GitHubApiError("GitHub API returned 403 Forbidden.", "unknown", 403);
  }
  if (!res.ok) {
    throw new GitHubApiError(`GitHub API returned unexpected status ${res.status}.`, "unknown", res.status);
  }
  return res;
}

export async function fetchDefaultBranch(owner, repo) {
  const res = await githubFetch(`https://api.github.com/repos/${owner}/${repo}`);
  const json = await res.json();
  return json.default_branch;
}

export async function fetchTree(owner, repo, branch) {
  const res = await githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
  );
  const json = await res.json();
  const entries = (json.tree || []).map((e) => ({ path: e.path, type: e.type, size: e.size, sha: e.sha }));
  return { entries, truncated: Boolean(json.truncated) };
}

export async function fetchReadme(owner, repo, branch) {
  const candidates = ["README.md", "README.MD", "readme.md", "Readme.md", "README"];
  for (const name of candidates) {
    try {
      const res = await fetch(
        `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${name}`
      );
      if (res.ok) return await res.text();
    } catch {
      // try next candidate
    }
  }
  return null;
}

export async function fetchRawFile(owner, repo, branch, path, maxChars = 50000) {
  let res;
  try {
    res = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${path
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`
    );
  } catch (err) {
    throw new GitHubApiError(`Network error fetching ${path}: ${err.message}`, "network");
  }
  if (!res.ok) {
    throw new GitHubApiError(`Failed to fetch ${path} (status ${res.status}).`, "unknown", res.status);
  }
  const text = await res.text();
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + `\n...[truncated, original length ${text.length} chars]`;
}
