const listeners = new Set();

let state = {
  view: "landing", // 'landing' | 'progress' | 'wiki' | 'error'
  progress: null,  // { phase, total, done, moduleName, steps: [] }
  wiki: null,      // WikiData currently displayed
  wikiActivePageId: null,
  error: null,     // { message, kind }
};

export function getState() {
  return state;
}

export function setState(patch) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
