import { el, clear } from "../utils/dom.js";
import { renderMarkdownToHtml } from "../render/markdown-renderer.js";
import { renderMermaidIn } from "../render/mermaid-renderer.js";
import { setState } from "../state.js";
import { getSettings, saveCachedWiki } from "../storage/cache.js";
import { askQuestion } from "../pipeline/qa.js";
import { mapErrorToMessage } from "../utils/errors.js";

const ASK_PAGE_ID = "__ask__";

export function mountWikiView(root, wikiData, activePageId, { onRegenerate, onBack }) {
  clear(root);

  const pages = [...wikiData.pages].sort((a, b) => a.order - b.order);
  const isAskActive = activePageId === ASK_PAGE_ID;
  const activePage = isAskActive ? null : pages.find((p) => p.id === activePageId) || pages[0];

  function navigate(id) {
    setState({ wikiActivePageId: id });
    mountWikiView(root, wikiData, id, { onRegenerate, onBack });
  }

  const askNav = el("ul", { class: "wiki-nav" }, [
    el("li", {}, [
      el(
        "a",
        {
          href: "#",
          class: isAskActive ? "active" : "",
          onClick: (e) => {
            e.preventDefault();
            navigate(ASK_PAGE_ID);
          },
        },
        "💬 Ask"
      ),
    ]),
  ]);

  const pagesNav = el(
    "ul",
    { class: "wiki-nav" },
    pages.map((page) =>
      el("li", {}, [
        el(
          "a",
          {
            href: "#",
            class: !isAskActive && page.id === activePage.id ? "active" : "",
            onClick: (e) => {
              e.preventDefault();
              navigate(page.id);
            },
          },
          page.title
        ),
      ])
    )
  );

  const sidebar = el("div", { class: "wiki-sidebar" }, [
    el("div", { class: "wiki-sidebar-header" }, [
      el("button", { class: "btn btn-ghost", type: "button", onClick: onBack }, "← Back"),
    ]),
    askNav,
    el("div", { style: "height:1px;background:var(--border);margin:10px 16px;" }),
    pagesNav,
  ]);

  const header = el(
    "div",
    { style: "display:flex;justify-content:space-between;align-items:baseline;gap:12px;max-width:760px;margin:0 auto 8px;" },
    [
      el(
        "div",
        { class: "card-meta" },
        `${wikiData.owner}/${wikiData.repo} · ${wikiData.branch} · generated ${new Date(wikiData.generated_at).toLocaleString()}`
      ),
      el("button", { class: "btn btn-ghost", type: "button", onClick: onRegenerate }, "↻ Regenerate"),
    ]
  );

  let content;
  if (isAskActive) {
    content = el("div", { class: "wiki-content qa-active" }, [header, mountAskPanel(wikiData)]);
  } else {
    const contentInner = el("div", { class: "wiki-content-inner markdown-body", html: renderMarkdownToHtml(activePage.markdown) });
    content = el("div", { class: "wiki-content" }, [header, contentInner]);
    renderMermaidIn(contentInner);
  }

  root.appendChild(el("div", { class: "wiki-shell" }, [sidebar, content]));
}

function mountAskPanel(wikiData) {
  const qaHistory = wikiData.qaHistory || (wikiData.qaHistory = []);

  const messagesEl = el("div", { class: "qa-messages" });

  function renderMessages() {
    clear(messagesEl);
    if (qaHistory.length === 0) {
      messagesEl.appendChild(
        el("div", { class: "qa-empty-hint" }, `Ask a question about ${wikiData.owner}/${wikiData.repo} — answered using the generated wiki as context.`)
      );
    }
    for (const m of qaHistory) {
      if (m.role === "user") {
        messagesEl.appendChild(el("div", { class: "qa-message user" }, m.content));
      } else if (m.isError) {
        messagesEl.appendChild(el("div", { class: "qa-message error" }, m.content));
      } else {
        messagesEl.appendChild(el("div", { class: "qa-message assistant markdown-body", html: renderMarkdownToHtml(m.content) }));
      }
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  renderMessages();

  const textarea = el("textarea", { placeholder: "Ask about this repo…", rows: "1" });
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  const sendBtn = el("button", { class: "btn btn-primary", type: "button", onClick: () => send() }, "Send");

  async function send() {
    const question = textarea.value.trim();
    if (!question) return;

    const settings = getSettings();
    if (!settings) {
      qaHistory.push({ role: "assistant", isError: true, content: "Configure your API connection in Settings before asking questions." });
      renderMessages();
      return;
    }

    textarea.value = "";
    textarea.disabled = true;
    sendBtn.disabled = true;

    qaHistory.push({ role: "user", content: question });
    renderMessages();

    const pending = el("div", { class: "qa-message assistant pending" }, [el("span", { class: "spinner" }), "Thinking…"]);
    messagesEl.appendChild(pending);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    try {
      const history = qaHistory.slice(0, -1).filter((m) => !m.isError);
      const answer = await askQuestion({ wikiData, question, history, settings });
      qaHistory.push({ role: "assistant", content: answer });
      saveCachedWiki(wikiData);
    } catch (err) {
      qaHistory.push({ role: "assistant", isError: true, content: mapErrorToMessage(err) });
    }

    textarea.disabled = false;
    sendBtn.disabled = false;
    renderMessages();
    textarea.focus();
  }

  return el("div", { class: "qa-panel" }, [
    messagesEl,
    el("div", { class: "qa-input-row" }, [textarea, sendBtn]),
  ]);
}
