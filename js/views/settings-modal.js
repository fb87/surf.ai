import { el, clear } from "../utils/dom.js";
import { getSettings, saveSettings, isSettingsValid, listConnections, deleteConnection } from "../storage/cache.js";

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

export function openSettings({ notice, onSaved } = {}) {
  onSavedCallback = onSaved || null;
  render(notice);
  dialog.showModal();
}

document.getElementById("settings-btn").addEventListener("click", () => openSettings());
