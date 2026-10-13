import * as github from "./github.js";
import * as gitlab from "./gitlab.js";
import * as bitbucketCloud from "./bitbucket-cloud.js";
import * as bitbucketServer from "./bitbucket-server.js";
import * as gitee from "./gitee.js";

const ALL_ADAPTERS = [github, gitlab, bitbucketCloud, bitbucketServer, gitee];

const KNOWN_HOSTS = {
  "github.com": github,
  "gitlab.com": gitlab,
  "bitbucket.org": bitbucketCloud,
  "gitee.com": gitee,
};

// Shown when a pasted URL's host isn't one of the known public clouds.
// Bitbucket Cloud and Gitee are single-host services, so they're excluded —
// only the providers with a "custom domain" variant make sense here.
export const UNKNOWN_HOST_PROVIDERS = [
  { id: "github", label: "GitHub Enterprise" },
  { id: "gitlab", label: "GitLab (self-hosted)" },
  { id: "bitbucket-server", label: "Bitbucket Server / Data Center" },
];

// Returns the host only when the input actually specifies one: either it has
// an http(s):// protocol, or its first path segment looks domain-like
// (contains a dot). Bare "owner/repo" input has neither, and is treated as
// having no explicit host rather than misreading "owner" as a hostname.
export function extractHost(input) {
  const trimmed = input.trim();
  const hadProtocol = /^https?:\/\//.test(trimmed);
  const rest = trimmed.replace(/^https?:\/\//, "");
  const m = rest.match(/^([^/]+)/);
  const firstSeg = m ? m[1] : null;
  if (!firstSeg) return null;
  if (hadProtocol || firstSeg.includes(".")) return firstSeg;
  return null;
}

// Returns { adapter, ref } for a known public host (or bare "owner/repo",
// which defaults to GitHub), or { needsProviderSelection: true, host } when
// the caller must ask the user which provider type a custom-domain host is.
export function resolveProvider(input) {
  const host = extractHost(input);
  if (!host) {
    return { adapter: github, ref: github.parseUrl(input) };
  }
  if (KNOWN_HOSTS[host]) {
    const adapter = KNOWN_HOSTS[host];
    return { adapter, ref: adapter.parseUrl(input, host) };
  }
  return { needsProviderSelection: true, host };
}

export function resolveWithProvider(input, providerId) {
  const adapter = getAdapterById(providerId);
  if (!adapter) throw new Error(`Unknown provider "${providerId}".`);
  const host = extractHost(input) || undefined;
  return { adapter, ref: adapter.parseUrl(input, host) };
}

export function getAdapterById(providerId) {
  return ALL_ADAPTERS.find((a) => a.id === providerId);
}
