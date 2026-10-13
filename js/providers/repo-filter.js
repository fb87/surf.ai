export const NOISE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".webp", ".bmp", ".pdf",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".mp4", ".mov", ".avi", ".mp3", ".wav",
  ".zip", ".tar", ".gz", ".tgz", ".rar", ".7z",
  ".exe", ".dll", ".so", ".dylib", ".class", ".jar", ".wasm", ".o", ".a",
  ".lock", ".map",
]);

export const NOISE_FILENAMES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "composer.lock",
  "Gemfile.lock", "poetry.lock", "Cargo.lock",
]);

export const NOISE_PATH_SEGMENTS = [
  "node_modules", ".git", "dist", "build", "vendor", "coverage",
  ".next", "target", "__pycache__", ".venv",
];

export function isNoise(path) {
  const segments = path.split("/");
  const filename = segments[segments.length - 1];

  if (NOISE_FILENAMES.has(filename)) return true;
  if (/\.min\.(js|css)$/.test(filename)) return true;

  const extMatch = filename.match(/\.[^.]+$/);
  if (extMatch && NOISE_EXTENSIONS.has(extMatch[0].toLowerCase())) return true;

  for (const seg of segments) {
    if (NOISE_PATH_SEGMENTS.includes(seg)) return true;
  }
  return false;
}

export function classifyFiles(
  treeEntries,
  opts = {}
) {
  const { maxFileBytes = 50_000, maxTotalFiles = 300, maxTotalBytes = 1_500_000 } = opts;

  let candidates = treeEntries
    .filter((e) => e.type === "blob")
    .filter((e) => !isNoise(e.path))
    .filter((e) => typeof e.size !== "number" || e.size <= maxFileBytes)
    .map((e) => ({ path: e.path, size: e.size || 0, sha: e.sha }));

  candidates.sort((a, b) => b.size - a.size);

  const result = [];
  let totalBytes = 0;
  for (const f of candidates) {
    if (result.length >= maxTotalFiles) break;
    if (totalBytes + f.size > maxTotalBytes) continue;
    result.push(f);
    totalBytes += f.size;
  }
  return result;
}

// A stable per-file identity signal for incremental-update change detection.
// Prefers content hash (GitHub/GitLab/Gitee all expose a blob sha) over size
// (Bitbucket Cloud's only available signal) over "unknown" (Bitbucket Server's
// /files endpoint returns bare paths with neither — meaning incremental update
// can detect added/removed files there, but not in-place edits to existing ones).
export function fileSignature(file) {
  if (file.sha) return `sha:${file.sha}`;
  if (typeof file.size === "number") return `size:${file.size}`;
  return "unknown";
}

// A single string capturing a module's exact file set + each file's content
// signature. Unchanged iff this string is identical to the prior run's.
export function moduleSignature(module) {
  return module.files
    .map((f) => `${f.path}:${fileSignature(f)}`)
    .sort()
    .join("|");
}

export function groupIntoModules(
  filteredFiles,
  opts = {}
) {
  const { maxModules = 12, maxFilesPerModule = 15, maxBytesPerModule = 40_000 } = opts;

  const buckets = new Map();
  for (const file of filteredFiles) {
    const slashIdx = file.path.indexOf("/");
    const moduleName = slashIdx === -1 ? "(root)" : file.path.slice(0, slashIdx);
    if (!buckets.has(moduleName)) buckets.set(moduleName, []);
    buckets.get(moduleName).push(file);
  }

  let modules = Array.from(buckets.entries()).map(([name, files]) => {
    const sortedFiles = [...files].sort((a, b) => b.size - a.size);
    const kept = [];
    let bytes = 0;
    for (const f of sortedFiles) {
      if (kept.length >= maxFilesPerModule) break;
      if (bytes + f.size > maxBytesPerModule && kept.length > 0) continue;
      kept.push(f);
      bytes += f.size;
    }
    return { name, files: kept, totalSize: bytes };
  });

  modules.sort((a, b) => b.totalSize - a.totalSize);
  return modules.slice(0, maxModules);
}
