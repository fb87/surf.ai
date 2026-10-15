import { el, clear, relativeTime, formatBytes } from "../utils/dom.js";
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
    value: "github.com/fb87/surf.ai",
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

  const PAGE_SIZE = 10;
  const cached = listCachedRepos();
  const list = el("div", { class: "cached-list" });

  if (cached.length === 0) {
    list.appendChild(el("div", { class: "empty-state" }, "No repositories generated yet. Paste a URL above to get started."));
  } else {
    list.appendChild(el("h2", {}, "Previously Generated"));

    let filterText = "";
    let currentPage = 1;
    const cardsContainer = el("div", {});

    function renderCards() {
      clear(cardsContainer);
      const needle = filterText.trim().toLowerCase();
      const filtered = needle
        ? cached.filter((e) => `${e.owner}/${e.repo}`.toLowerCase().includes(needle) || e.host.toLowerCase().includes(needle))
        : cached;

      if (filtered.length === 0) {
        cardsContainer.appendChild(el("div", { class: "empty-state" }, `No cached repos match "${filterText.trim()}".`));
        return;
      }

      const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      if (currentPage > totalPages) currentPage = totalPages;
      const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

      for (const entry of pageItems) {
        cardsContainer.appendChild(renderCachedCard(entry, root, { onGenerateRepo }));
      }

      if (totalPages > 1) {
        cardsContainer.appendChild(
          el("div", { class: "pager" }, [
            el(
              "button",
              {
                class: "btn btn-ghost",
                type: "button",
                disabled: currentPage === 1 ? "disabled" : undefined,
                onClick: () => {
                  if (currentPage > 1) {
                    currentPage--;
                    renderCards();
                  }
                },
              },
              "← Prev"
            ),
            el("span", { class: "card-meta" }, `Page ${currentPage} of ${totalPages} (${filtered.length} repos)`),
            el(
              "button",
              {
                class: "btn btn-ghost",
                type: "button",
                disabled: currentPage === totalPages ? "disabled" : undefined,
                onClick: () => {
                  if (currentPage < totalPages) {
                    currentPage++;
                    renderCards();
                  }
                },
              },
              "Next →"
            ),
          ])
        );
      }
    }

    const filterInput = el("input", {
      type: "text",
      class: "cached-filter-input",
      placeholder: "Filter by owner/repo or host…",
      "aria-label": "Filter cached repositories",
    });
    filterInput.addEventListener("input", () => {
      filterText = filterInput.value;
      currentPage = 1;
      renderCards();
    });
    list.appendChild(filterInput);
    list.appendChild(cardsContainer);
    renderCards();
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
        `${entry.host} · branch: ${entry.branch} · ${formatBytes(entry.sizeBytes || 0)} · generated ${relativeTime(entry.generatedAt)}`
      ),
      el(
        "div",
        { class: "card-meta" },
        `Generated with ${entry.llmModel || "model unavailable"} via ${entry.llmProvider || "provider unavailable"}`
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
            if (!wiki) {
              alert("This cached wiki could no longer be loaded (it may be from an older version of the app) and has been removed. Try generating it again.");
              deleteCachedWiki(entry.host, entry.owner, entry.repo, entry.branch);
              mountLandingView(root, { onGenerateRepo });
              return;
            }
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
