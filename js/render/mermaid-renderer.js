let initialized = false;

function currentMermaidTheme() {
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "dark") return "dark";
  if (explicit === "light") return "default";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default";
}

function ensureInitialized() {
  mermaid.initialize({ startOnLoad: false, theme: currentMermaidTheme(), securityLevel: "strict", fontFamily: "Alegreya Mono" });
  initialized = true;
}

export async function renderMermaidIn(containerEl) {
  if (!initialized) ensureInitialized();

  const nodes = containerEl.querySelectorAll("pre.mermaid");
  if (nodes.length === 0) return;
  try {
    await mermaid.run({ nodes: Array.from(nodes) });
  } catch (err) {
    // mermaid.run already renders an inline error SVG per-node on syntax errors;
    // this catch only guards against a totally unexpected top-level failure.
    console.error("Mermaid rendering failed:", err);
  }
}
