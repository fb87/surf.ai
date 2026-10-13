import { el, clear } from "../utils/dom.js";
import { UNKNOWN_HOST_PROVIDERS } from "../providers/detect.js";

const dialog = document.getElementById("provider-picker-modal");

export function openProviderPicker({ host, onSelect }) {
  clear(dialog);

  dialog.appendChild(
    el("div", { class: "modal-header" }, [
      el("h2", {}, "What kind of Git host is this?"),
      el("button", { class: "btn btn-ghost btn-icon", type: "button", onClick: () => dialog.close() }, "✕"),
    ])
  );

  const body = el("div", { class: "modal-body" }, [
    el("div", { class: "modal-notice" }, `"${host}" isn't a recognized public host (github.com, gitlab.com, bitbucket.org, gitee.com). Pick what it's running, so the right API is used.`),
  ]);

  for (const provider of UNKNOWN_HOST_PROVIDERS) {
    body.appendChild(
      el(
        "button",
        {
          class: "btn btn-ghost",
          type: "button",
          style: "width:100%;justify-content:flex-start;margin-bottom:8px;",
          onClick: () => {
            dialog.close();
            onSelect(provider.id);
          },
        },
        provider.label
      )
    );
  }
  dialog.appendChild(body);

  dialog.appendChild(
    el("div", { class: "modal-footer" }, [
      el("button", { class: "btn btn-ghost", type: "button", onClick: () => dialog.close() }, "Cancel"),
    ])
  );

  dialog.showModal();
}
