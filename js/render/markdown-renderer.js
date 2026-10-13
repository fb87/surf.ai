let configured = false;

function configureMarked() {
  const renderer = new marked.Renderer();
  const originalCode = renderer.code.bind(renderer);
  renderer.code = (code, infostring, escaped) => {
    const lang = (infostring || "").trim().toLowerCase();
    if (lang === "mermaid") {
      // Escape so raw diagram text can't break out of the <pre>; DOMPurify
      // sanitizes afterwards, and mermaid.run() parses the textContent itself.
      const safe = String(code)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `<pre class="mermaid">${safe}</pre>`;
    }
    return originalCode(code, infostring, escaped);
  };
  marked.setOptions({ renderer, gfm: true, breaks: false });
  configured = true;
}

export function renderMarkdownToHtml(markdownText) {
  if (!configured) configureMarked();
  const rawHtml = marked.parse(markdownText || "");
  return DOMPurify.sanitize(rawHtml, {
    ADD_TAGS: ["pre"],
    ADD_ATTR: ["class"],
  });
}
