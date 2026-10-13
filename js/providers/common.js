import { ProviderApiError } from "./provider-error.js";

const README_CANDIDATES = ["README.md", "README.MD", "readme.md", "Readme.md", "README"];

// Tries each candidate filename via the adapter's own fetchRawFile, returning
// the first one that resolves. Adapters that don't have a dedicated readme
// endpoint (GitLab, Bitbucket, Gitee) share this instead of re-implementing it.
export async function probeReadme(fetchRawFileFn, ref) {
  for (const name of README_CANDIDATES) {
    try {
      return await fetchRawFileFn(ref, name, 50_000);
    } catch {
      // try next candidate
    }
  }
  return null;
}

export async function providerFetch(url, { headers = {}, accept404 = false } = {}) {
  let res;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    throw new ProviderApiError(`Network error reaching the repository host: ${err.message}`, "network");
  }

  if (res.status === 404 && accept404) return null;
  if (res.status === 404) {
    throw new ProviderApiError("Repository, branch, or file not found.", "not_found", 404);
  }
  if (res.status === 401 || res.status === 403) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining === "0") {
      throw new ProviderApiError("API rate limit exceeded for unauthenticated access. Wait a bit and try again.", "rate_limited", res.status);
    }
    throw new ProviderApiError(
      "Access denied (401/403). This host may require authentication for API access, which isn't supported — only unauthenticated/public access is.",
      "unauthorized",
      res.status
    );
  }
  if (res.status === 429) {
    throw new ProviderApiError("API rate limit exceeded. Wait a bit and try again.", "rate_limited", 429);
  }
  if (!res.ok) {
    throw new ProviderApiError(`Repository host returned unexpected status ${res.status}.`, "unknown", res.status);
  }
  return res;
}

export function normalizeHost(input) {
  return input.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

export function truncateText(text, maxChars) {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + `\n...[truncated, original length ${text.length} chars]`;
}
