class ParseError extends Error {}

export function extractJson(text) {
  const direct = tryParse(text.trim());
  if (direct !== undefined) return direct;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    const parsed = tryParse(fenced[1].trim());
    if (parsed !== undefined) return parsed;
  }

  const balanced = extractFirstBalancedObject(text);
  if (balanced !== null) {
    const parsed = tryParse(balanced);
    if (parsed !== undefined) return parsed;
  }

  throw new ParseError("Could not extract valid JSON from model response.");
}

function tryParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return undefined;
  }
}

function extractFirstBalancedObject(text) {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escapeNext) escapeNext = false;
      else if (ch === "\\") escapeNext = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function validateModuleSummary(json, moduleName) {
  if (
    json &&
    typeof json.purpose === "string" &&
    Array.isArray(json.key_files) &&
    Array.isArray(json.responsibilities)
  ) {
    return {
      module: moduleName,
      purpose: json.purpose,
      key_files: json.key_files.filter((f) => typeof f === "string"),
      responsibilities: json.responsibilities.filter((r) => typeof r === "string"),
      dependencies: Array.isArray(json.dependencies) ? json.dependencies.filter((d) => typeof d === "string") : [],
      degraded: false,
    };
  }
  return {
    module: moduleName,
    purpose: "(summary unavailable — the model's response couldn't be parsed)",
    key_files: [],
    responsibilities: [],
    dependencies: [],
    degraded: true,
  };
}

export function validateWikiStructure(json) {
  if (!json || !Array.isArray(json.pages) || json.pages.length === 0) {
    throw new ParseError("Response did not contain a non-empty `pages` array.");
  }

  const pages = json.pages
    .filter(
      (p) =>
        p &&
        typeof p.id === "string" &&
        p.id.length > 0 &&
        typeof p.title === "string" &&
        p.title.length > 0 &&
        typeof p.markdown === "string" &&
        p.markdown.length > 0
    )
    .map((p, i) => ({ id: p.id, title: p.title, markdown: p.markdown, order: typeof p.order === "number" ? p.order : i }));

  if (pages.length === 0) {
    throw new ParseError("No valid pages found after filtering malformed entries.");
  }

  const seen = new Set();
  const deduped = [];
  for (const p of pages.sort((a, b) => a.order - b.order)) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    deduped.push(p);
  }

  if (!deduped.some((p) => p.id === "overview")) {
    deduped.unshift({
      id: "overview",
      title: "Overview",
      order: -1,
      markdown: "# Overview\n\n_No overview was returned by the model._",
    });
  }

  return { pages: deduped };
}
