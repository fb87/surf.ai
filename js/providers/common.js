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

function rateLimitMessage(res) {
  const resetHeader = res.headers.get("x-ratelimit-reset");
  if (resetHeader) {
    const resetDate = new Date(Number(resetHeader) * 1000);
    if (!Number.isNaN(resetDate.getTime())) {
      return `API rate limit exceeded for unauthenticated access. Resets at ${resetDate.toLocaleTimeString()}.`;
    }
  }
  return "API rate limit exceeded for unauthenticated access. Wait a bit and try again.";
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
    const limit = res.headers.get("x-ratelimit-limit");
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining === "0" && limit !== "0") {
      // A genuine rate limit: anonymous access is allowed and has a real
      // quota (limit > 0), it's just been used up for this window.
      throw new ProviderApiError(rateLimitMessage(res), "rate_limited", res.status);
    }
    if (limit === "0") {
      // The host reports zero quota for anonymous access at all — this isn't
      // "you used it up," it's "this isn't allowed here," most commonly a
      // GitHub Enterprise Server instance with anonymous access disabled.
      // Waiting out a "rate limit" would never fix this, so it's reported as
      // an auth problem instead.
      throw new ProviderApiError(
        "This host isn't granting any API quota for unauthenticated access (likely anonymous access is disabled on this instance) — authentication would be required, which isn't supported here.",
        "unauthorized",
        res.status
      );
    }
    throw new ProviderApiError(
      "Access denied (401/403). This host may require authentication for API access, which isn't supported — only unauthenticated/public access is.",
      "unauthorized",
      res.status
    );
  }
  if (res.status === 429) {
    throw new ProviderApiError(rateLimitMessage(res), "rate_limited", 429);
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
