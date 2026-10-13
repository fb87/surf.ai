import { el, clear, relativeTime } from "../utils/dom.js";
import { listCachedRepos, deleteCachedWiki, getCachedWiki } from "../storage/cache.js";
import { setState } from "../state.js";

let onGenerate = null;

export function mountLandingView(root, { onGenerateRepo }) {
  onGenerate = onGenerateRepo;
  clear(root);

  const input = el("input", {
    type: "text",
    placeholder: "github.com/owner/repo, gitlab.com/owner/repo, bitbucket.org/owner/repo…",
    "aria-label": "Git repository URL",
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });

  const errorBox = el("div", { class: "field-error hidden" });

  function submit() {
    const value = input.value.trim();
    if (!value) {
      errorBox.textContent = "Enter a repository URL, e.g. github.com/owner/repo";
      errorBox.classList.remove("hidden");
      return;
    }
    errorBox.classList.add("hidden");
    onGenerate(value);
  }

  const form = el("div", { class: "repo-form" }, [
    input,
    el("button", { class: "btn btn-primary", type: "button", onClick: submit }, "Generate Wiki"),
  ]);

  const cached = listCachedRepos();
  const list = el("div", { class: "cached-list" });
  if (cached.length === 0) {
    list.appendChild(el("div", { class: "empty-state" }, "No repositories generated yet. Paste a URL above to get started."));
  } else {
    list.appendChild(el("h2", {}, "Previously Generated"));
    for (const entry of cached) {
      list.appendChild(renderCachedCard(entry, root, { onGenerateRepo }));
    }
  }

  root.appendChild(
    el("div", { class: "landing" }, [
      el("h1", {}, "Generate a wiki for any public Git repo"),
      el("p", { class: "subtitle" }, "Paste a repository URL. An LLM analyzes its structure and writes a browsable wiki — cached locally in your browser."),
      form,
      errorBox,
      list,
    ])
  );
}

function renderCachedCard(entry, root, { onGenerateRepo }) {
  return el("div", { class: "card" }, [
    el("div", {}, [
      el("div", { class: "card-title" }, `${entry.owner}/${entry.repo}`),
      el(
        "div",
        { class: "card-meta" },
        `${entry.host} · branch: ${entry.branch} · generated ${relativeTime(entry.generatedAt)}`
      ),
    ]),
    el("div", { class: "card-actions" }, [
      el(
        "button",
        {
          class: "btn btn-ghost",
          type: "button",
          onClick: () => {
            const wiki = getCachedWiki(entry.host, entry.owner, entry.repo, entry.branch);
            setState({ view: "wiki", wiki, wikiActivePageId: wiki.pages[0]?.id || null });
          },
        },
        "Open"
      ),
      el(
        "button",
        {
          class: "btn btn-ghost btn-danger",
          type: "button",
          onClick: () => {
            if (!confirm(`Delete cached wiki for ${entry.owner}/${entry.repo}?`)) return;
            deleteCachedWiki(entry.host, entry.owner, entry.repo, entry.branch);
            mountLandingView(root, { onGenerateRepo });
          },
        },
        "Delete"
      ),
    ]),
  ]);
}
