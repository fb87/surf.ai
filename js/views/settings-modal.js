import { el, clear, formatBytes } from "../utils/dom.js";
import { getSettings, saveSettings, isSettingsValid, listConnections, deleteConnection, exportAllData, importAllData, getStorageUsage, clearAllCachedWikis } from "../storage/cache.js";
import { listModels } from "../llm/llm-client.js";
import { mapErrorToMessage } from "../utils/errors.js";

const dialog = document.getElementById("settings-modal");
let onSavedCallback = null;

const PREDEFINED_BASE_URLS = [
  { label: "OpenAI", value: "https://api.openai.com/v1" },
  { label: "Google Gemini", value: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { label: "Anthropic", value: "https://api.anthropic.com/v1" },
  { label: "Groq", value: "https://api.groq.com/openai/v1" },
  { label: "OpenRouter", value: "https://openrouter.ai/api/v1" },
  { label: "Local Ollama", value: "http://localhost:11434/v1" },
  { label: "Local LM Studio", value: "http://localhost:1234/v1" },
];

const PREDEFINED_MODELS = [
  "gpt-4o-mini",
  "gpt-4o",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "claude-sonnet-5",
  "claude-haiku-4-5-20251001",
  "claude-opus-5",
  "llama-3.1-8b-instant",
  "llama-3.3-70b-versatile",
];

const KNOWN_BASE_URL_HOSTNAMES = new Set(PREDEFINED_BASE_URLS.map((p) => new URL(p.value).hostname));

function isLocalHostname(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.endsWith(".local");
}

function render(notice) {
  clear(dialog);
  const settings = getSettings() || {};

  const baseUrlInput = el("input", {
    type: "text",
    id: "settings-base-url",
    list: "settings-base-url-options",
    placeholder: "https://api.openai.com/v1",
    value: settings.baseUrl || "",
  });
  const baseUrlDatalist = el(
    "datalist",
    { id: "settings-base-url-options" },
    PREDEFINED_BASE_URLS.map((p) => el("option", { value: p.value, label: p.label }))
  );
  const apiKeyInput = el("input", {
    type: "password",
    id: "settings-api-key",
    placeholder: "sk-... (leave blank if not required)",
    value: settings.apiKey || "",
  });
  const modelInput = el("input", {
    type: "text",
    id: "settings-model",
    list: "settings-model-options",
    placeholder: "gpt-4o-mini",
    value: settings.model || "",
  });
  const modelDatalist = el("datalist", { id: "settings-model-options" }, PREDEFINED_MODELS.map((m) => el("option", { value: m })));
  const modelStatus = el("div", { class: "field-hint" }, "e.g. gpt-4o-mini, llama3.1, claude-sonnet-5");

  const fetchModelsBtn = el(
    "button",
    {
      type: "button",
      class: "btn btn-ghost",
      onClick: async () => {
        const baseUrl = baseUrlInput.value.trim();
        const apiKey = apiKeyInput.value.trim();
        if (!baseUrl) {
          modelStatus.textContent = "Enter a Base URL first.";
          return;
        }
        fetchModelsBtn.disabled = true;
        fetchModelsBtn.textContent = "Fetching…";
        modelStatus.textContent = "Fetching available models…";
        try {
          const models = await listModels({ baseUrl, apiKey });
          clear(modelDatalist);
          for (const m of models) modelDatalist.appendChild(el("option", { value: m }));
          modelStatus.textContent = models.length
            ? `Loaded ${models.length} model${models.length === 1 ? "" : "s"} from the endpoint — pick one from the dropdown.`
            : "The endpoint returned no models.";
        } catch (err) {
          modelStatus.textContent = mapErrorToMessage(err);
        }
        fetchModelsBtn.disabled = false;
        fetchModelsBtn.textContent = "🔄 Fetch Models";
      },
    },
    "🔄 Fetch Models"
  );

  const errorBox = el("div", { class: "field-error hidden" });

  const baseUrlWarning = el("div", { class: "field-error hidden" });
  function updateBaseUrlWarning() {
    const value = baseUrlInput.value.trim();
    let hostname;
    try {
      hostname = new URL(value).hostname;
    } catch {
      baseUrlWarning.classList.add("hidden");
      return;
    }
    if (KNOWN_BASE_URL_HOSTNAMES.has(hostname) || isLocalHostname(hostname)) {
      baseUrlWarning.classList.add("hidden");
    } else {
      baseUrlWarning.textContent = `⚠ "${hostname}" isn't one of the recognized providers above — make sure you trust this endpoint before your API key is sent to it.`;
      baseUrlWarning.classList.remove("hidden");
    }
  }
  baseUrlInput.addEventListener("input", updateBaseUrlWarning);

  const toggleKeyBtn = el(
    "button",
    {
      type: "button",
      class: "btn btn-ghost",
      onClick: () => {
        apiKeyInput.type = apiKeyInput.type === "password" ? "text" : "password";
        toggleKeyBtn.textContent = apiKeyInput.type === "password" ? "Show" : "Hide";
      },
    },
    "Show"
  );

  dialog.appendChild(
    el("div", { class: "modal-header" }, [
      el("h2", {}, "Connection Settings"),
      el("button", { class: "btn btn-ghost btn-icon", type: "button", onClick: () => dialog.close() }, "✕"),
    ])
  );

  const body = el("div", { class: "modal-body" });
  if (notice) body.appendChild(el("div", { class: "modal-notice" }, notice));

  const history = listConnections();
  if (history.length > 0) {
    const historyList = el("div", { class: "connection-history" });
    for (const conn of history) {
      let hostLabel = conn.baseUrl;
      try {
        hostLabel = new URL(conn.baseUrl).hostname;
      } catch {
        /* keep raw baseUrl if unparsable */
      }
      historyList.appendChild(
        el("div", { class: "connection-row" }, [
          el(
            "button",
            {
              type: "button",
              class: "btn btn-ghost connection-row-use",
              onClick: () => {
                baseUrlInput.value = conn.baseUrl;
                apiKeyInput.value = conn.apiKey || "";
                modelInput.value = conn.model;
              },
            },
            [el("span", { class: "connection-row-model" }, conn.model), el("span", { class: "connection-row-host" }, hostLabel)]
          ),
          el(
            "button",
            {
              type: "button",
              class: "btn btn-ghost btn-icon btn-danger",
              title: "Remove from history",
              onClick: () => {
                deleteConnection(conn.baseUrl, conn.model);
                render(notice); // dialog is already open; just rebuild its content
              },
            },
            "✕"
          ),
        ])
      );
    }
    body.appendChild(
      el("div", { class: "field" }, [el("label", {}, "Recent connections"), historyList])
    );
  }

  body.appendChild(
    el("div", { class: "field" }, [
      el("label", { for: "settings-base-url" }, "Base URL"),
      baseUrlInput,
      baseUrlDatalist,
      el("div", { class: "field-hint" }, "Pick a predefined provider or type your own, e.g. a GitHub Enterprise-style custom endpoint."),
      baseUrlWarning,
    ])
  );
  updateBaseUrlWarning();
  body.appendChild(
    el("div", { class: "field" }, [
      el("label", { for: "settings-api-key" }, "API Key (optional)"),
      el("div", { class: "input-with-toggle" }, [apiKeyInput, toggleKeyBtn]),
      el("div", { class: "field-hint" }, "Leave blank for local servers that don't require auth (e.g. Ollama, LM Studio)."),
    ])
  );
  body.appendChild(
    el("div", { class: "field" }, [
      el("label", { for: "settings-model" }, "Model"),
      el("div", { style: "display:flex;gap:8px;" }, [modelInput, fetchModelsBtn]),
      modelDatalist,
      modelStatus,
    ])
  );
  body.appendChild(errorBox);
  body.appendChild(renderStorageSection(notice));
  body.appendChild(renderBackupSection(notice));
  dialog.appendChild(body);

  dialog.appendChild(
    el("div", { class: "modal-footer" }, [
      el("button", { class: "btn btn-ghost", type: "button", onClick: () => dialog.close() }, "Cancel"),
      el(
        "button",
        {
          class: "btn btn-primary",
          type: "button",
          onClick: () => {
            const candidate = {
              baseUrl: baseUrlInput.value.trim(),
              apiKey: apiKeyInput.value.trim(),
              model: modelInput.value.trim(),
            };
            if (!isSettingsValid(candidate)) {
              errorBox.textContent = "Please provide a valid Base URL and a Model name.";
              errorBox.classList.remove("hidden");
              return;
            }
            saveSettings(candidate);
            dialog.close();
            if (onSavedCallback) onSavedCallback(candidate);
          },
        },
        "Save"
      ),
    ])
  );
}

function renderStorageSection(notice) {
  const usage = getStorageUsage();

  return el("div", { class: "field" }, [
    el("label", {}, "Storage"),
    el(
      "div",
      { class: "field-hint" },
      `${formatBytes(usage.totalBytes)} used in this browser — ${usage.wikiCount} cached ${usage.wikiCount === 1 ? "wiki" : "wikis"} (${formatBytes(usage.wikiBytes)}). Browsers typically cap localStorage around 5–10 MB per site; oldest cached wikis are evicted automatically if that's hit.`
    ),
    usage.wikiCount > 0
      ? el(
          "button",
          {
            class: "btn btn-ghost btn-danger",
            type: "button",
            style: "margin-top:6px;",
            onClick: () => {
              if (!confirm(`Delete all ${usage.wikiCount} cached wikis? Settings and connection history are kept. This can't be undone.`)) return;
              clearAllCachedWikis();
              render(notice);
            },
          },
          "Clear All Cached Wikis"
        )
      : null,
  ]);
}

function renderBackupSection(notice) {
  const fileInput = el("input", {
    type: "file",
    accept: "application/json",
    class: "hidden",
    onChange: (e) => handleImportFile(e.target.files[0], notice),
  });

  const includeKeysCheckbox = el("input", { type: "checkbox", id: "backup-include-keys", checked: "checked" });

  return el("div", { class: "field" }, [
    el("label", {}, "Backup & Restore"),
    el(
      "div",
      { class: "field-hint" },
      "Exports or restores everything this app stores locally — settings, connection history, and cached wikis — as a JSON file."
    ),
    el("label", { for: "backup-include-keys", style: "display:flex;align-items:center;gap:6px;font-weight:400;margin-top:4px;" }, [
      includeKeysCheckbox,
      "Include API keys in export (leave checked for a full restore; uncheck to share/store the file somewhere less trusted)",
    ]),
    el("div", { style: "display:flex;gap:8px;margin-top:6px;" }, [
      el("button", { class: "btn btn-ghost", type: "button", onClick: () => handleExport(includeKeysCheckbox.checked) }, "⬇ Export Backup"),
      el("button", { class: "btn btn-ghost", type: "button", onClick: () => fileInput.click() }, "⬆ Import Backup"),
      fileInput,
    ]),
  ]);
}

function handleExport(includeApiKeys) {
  const payload = exportAllData({ includeApiKeys });
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: `surfai-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function handleImportFile(file, notice) {
  if (!file) return;

  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    alert("That file isn't valid JSON.");
    return;
  }

  const itemCount = payload?.data && typeof payload.data === "object" ? Object.keys(payload.data).length : 0;
  const exportedAtText = payload?.exportedAt ? new Date(payload.exportedAt).toLocaleString() : "an unknown date";
  const confirmed = confirm(
    `This will replace ALL current settings and cached wikis with this backup (${itemCount} items, exported ${exportedAtText}). This can't be undone. Continue?`
  );
  if (!confirmed) return;

  try {
    importAllData(payload);
  } catch (err) {
    alert(`Couldn't import: ${err.message}`);
    return;
  }

  alert("Backup restored. The page will now reload.");
  location.reload();
}

export function openSettings({ notice, onSaved } = {}) {
  onSavedCallback = onSaved || null;
  render(notice);
  dialog.showModal();
}

document.getElementById("settings-btn").addEventListener("click", () => openSettings());
