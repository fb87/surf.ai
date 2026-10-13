import { el, clear } from "../utils/dom.js";
import { getSettings, saveSettings, isSettingsValid, listConnections, deleteConnection, exportAllData, importAllData } from "../storage/cache.js";

const dialog = document.getElementById("settings-modal");
let onSavedCallback = null;

function render(notice) {
  clear(dialog);
  const settings = getSettings() || {};

  const baseUrlInput = el("input", {
    type: "text",
    id: "settings-base-url",
    placeholder: "https://api.openai.com/v1",
    value: settings.baseUrl || "",
  });
  const apiKeyInput = el("input", {
    type: "password",
    id: "settings-api-key",
    placeholder: "sk-... (leave blank if not required)",
    value: settings.apiKey || "",
  });
  const modelInput = el("input", {
    type: "text",
    id: "settings-model",
    placeholder: "gpt-4o-mini",
    value: settings.model || "",
  });

  const errorBox = el("div", { class: "field-error hidden" });

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
      el("div", { class: "field-hint" }, "OpenAI-compatible endpoint, e.g. https://api.openai.com/v1 or http://localhost:11434/v1"),
    ])
  );
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
      modelInput,
      el("div", { class: "field-hint" }, "e.g. gpt-4o-mini, llama3.1, claude-sonnet-5"),
    ])
  );
  body.appendChild(errorBox);
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

function renderBackupSection(notice) {
  const fileInput = el("input", {
    type: "file",
    accept: "application/json",
    class: "hidden",
    onChange: (e) => handleImportFile(e.target.files[0], notice),
  });

  return el("div", { class: "field" }, [
    el("label", {}, "Backup & Restore"),
    el(
      "div",
      { class: "field-hint" },
      "Exports or restores everything this app stores locally — settings, connection history, and cached wikis — as a JSON file. It contains your API key(s) in plain text, so store it somewhere safe."
    ),
    el("div", { style: "display:flex;gap:8px;margin-top:6px;" }, [
      el("button", { class: "btn btn-ghost", type: "button", onClick: handleExport }, "⬇ Export Backup"),
      el("button", { class: "btn btn-ghost", type: "button", onClick: () => fileInput.click() }, "⬆ Import Backup"),
      fileInput,
    ]),
  ]);
}

function handleExport() {
  const payload = exportAllData();
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
