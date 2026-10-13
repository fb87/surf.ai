import { el, clear } from "../utils/dom.js";

const PHASE_ORDER = ["fetching-tree", "pass1", "pass2", "up-to-date"];
const RENDERED_STEPS = ["fetching-tree", "pass1", "pass2"];
const STEP_LABELS = {
  "fetching-tree": "Fetching repository tree",
  pass1: "Checking modules for changes",
  pass2: "Synthesizing wiki",
};

export function mountProgressView(root, state) {
  clear(root);

  const list = el("ul", { class: "progress-list" });

  for (const stepKey of RENDERED_STEPS) {
    const order = PHASE_ORDER.indexOf(stepKey);
    const currentOrder = PHASE_ORDER.indexOf(state.phase);
    let status = "pending";
    if (order < currentOrder) status = "done";
    else if (order === currentOrder) status = "active";

    let icon = "○";
    if (status === "done") icon = "✓";
    if (status === "active") icon = "";

    const item = el("li", { class: `progress-item ${status}` }, [
      el("span", { class: "status-icon" }, status === "active" ? el("span", { class: "spinner" }) : icon),
      el("span", {}, STEP_LABELS[stepKey]),
    ]);
    list.appendChild(item);

    if (stepKey === "pass1" && status === "active" && state.moduleDone != null) {
      const reusedText = state.moduleReused ? `, ${state.moduleReused} reused` : "";
      item.appendChild(
        el("span", { class: "card-meta" }, ` (${state.moduleDone}/${state.moduleTotal}${reusedText}${state.moduleName ? `: ${state.moduleName}` : ""})`)
      );
    }
  }

  root.appendChild(
    el("div", { class: "progress-view" }, [
      el("h1", {}, `Generating wiki for ${state.owner}/${state.repo}`),
      list,
    ])
  );
}

export function mountProgressError(root, errorMessage, { onBack }) {
  clear(root);
  root.appendChild(
    el("div", { class: "progress-view" }, [
      el("h1", {}, "Couldn't generate wiki"),
      el("div", { class: "error-box" }, errorMessage),
      el("button", { class: "btn btn-ghost", type: "button", onClick: onBack }, "← Back"),
    ])
  );
}
