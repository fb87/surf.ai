const MODULE_SYSTEM_PROMPT =
  "You are a senior software engineer writing concise, accurate technical documentation " +
  "from source code. Respond with ONLY valid JSON, no markdown fences, no commentary before or after.";

const SYNTHESIS_SYSTEM_PROMPT =
  "You are a technical writer producing a developer wiki for a GitHub repository, in the " +
  "style of DeepWiki. Respond with ONLY valid JSON, no markdown fences, no commentary.";

export function buildModuleSummaryPrompt(mod, filesWithContent, repoMeta) {
  const fileBlocks = mod.files
    .map((f, i) => `### ${f.path}\n\`\`\`\n${filesWithContent[i]}\n\`\`\``)
    .join("\n\n");

  const userPrompt = `Repository: ${repoMeta.owner}/${repoMeta.repo}
Module/directory: ${mod.name}

Below are the contents of the most relevant files in this module (possibly truncated):

${fileBlocks}

Produce a JSON object with EXACTLY this shape:
{
  "module": "${mod.name}",
  "purpose": "1-2 sentence summary of what this module does",
  "key_files": ["path1", "path2"],
  "responsibilities": ["bullet", "bullet"],
  "dependencies": ["other module or external lib names this module relies on"]
}`;

  return {
    messages: [
      { role: "system", content: MODULE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  };
}

export function buildTreeOutline(treeEntries, maxChars = 4000) {
  const paths = treeEntries
    .filter((e) => e.type === "blob")
    .map((e) => e.path)
    .sort();
  let outline = "";
  for (const p of paths) {
    const line = p + "\n";
    if (outline.length + line.length > maxChars) {
      outline += `...[truncated, ${paths.length} files total]\n`;
      break;
    }
    outline += line;
  }
  return outline;
}

export function buildSynthesisPrompt({ readme, treeOutline, moduleSummaries, omittedModules }, repoMeta) {
  const summaryBlocks = moduleSummaries
    .map(
      (s) =>
        `### ${s.module}\nPurpose: ${s.purpose}\nKey files: ${s.key_files.join(", ") || "(none listed)"}\nResponsibilities: ${s.responsibilities.join("; ") || "(none listed)"}\nDependencies: ${s.dependencies.join(", ") || "(none listed)"}`
    )
    .join("\n\n");

  const omittedNote =
    omittedModules && omittedModules.length > 0
      ? `\n\nAdditional modules not detailed above due to size limits: ${omittedModules.join(", ")}`
      : "";

  const userPrompt = `Repository: ${repoMeta.owner}/${repoMeta.repo} (branch: ${repoMeta.branch})

README:
${readme || "(no README found)"}

File tree outline:
${treeOutline}

Module summaries:
${summaryBlocks}${omittedNote}

Produce a JSON object with EXACTLY this shape:
{
  "pages": [
    {
      "id": "overview",
      "title": "Overview",
      "order": 0,
      "markdown": "# Overview\\n\\n...markdown content..."
    },
    {
      "id": "architecture",
      "title": "Architecture",
      "order": 1,
      "markdown": "# Architecture\\n\\n...markdown with a mermaid diagram using \`\`\`mermaid fenced blocks..."
    }
  ]
}
Requirements:
- Always include an "overview" page and an "architecture" page first.
- The architecture page MUST include at least one \`\`\`mermaid code block (flowchart or graph TD) showing how modules relate to each other.
- Include one additional page per significant module from the summaries above (id = slugified module name), explaining its purpose, key files, and how it fits into the whole project.
- Use GitHub-flavored markdown. Do not include any text outside the JSON object.`;

  return {
    messages: [
      { role: "system", content: SYNTHESIS_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  };
}
