const BUTTON_SELECTOR = "[data-masterquest-open-authoring]";

export function injectMasterQuestJournalDirectoryButton(element, { onClick } = {}) {
  const root = resolveRootElement(element);
  if (!root || root.querySelector(BUTTON_SELECTOR)) {
    return false;
  }

  const footer = findOrCreateFooter(root);
  if (!footer) {
    return false;
  }

  const button = root.ownerDocument.createElement("button");
  button.type = "button";
  button.className = "masterquest-journal-open";
  button.dataset.masterquestOpenAuthoring = "true";
  button.title = "Open MasterQuest";
  button.innerHTML = '<i class="fa-solid fa-scroll" inert></i><span>MasterQuest</span>';
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick?.();
  });

  footer.appendChild(button);
  return true;
}

function resolveRootElement(element) {
  if (!element) {
    return null;
  }

  if (element instanceof HTMLElement) {
    return element;
  }

  if (Array.isArray(element)) {
    return element.find((entry) => entry instanceof HTMLElement) ?? null;
  }

  if (typeof element.get === "function") {
    const entry = element.get(0);
    if (entry instanceof HTMLElement) {
      return entry;
    }
  }

  return null;
}

function findOrCreateFooter(root) {
  const existing = root.querySelector(".directory-footer");
  if (existing) {
    return existing;
  }

  const footer = root.ownerDocument.createElement("footer");
  footer.className = "directory-footer action-buttons flexcol";

  // Foundry v14 renders the directory as `<ol class="directory-list">` inside the
  // `directory` application part; v13 used a `.directory` container. Never append the
  // footer inside the list itself, because `<footer>` is not valid inside `<ol>`.
  const list = root.querySelector(".directory-list");
  if (list?.parentElement) {
    list.parentElement.appendChild(footer);
    return footer;
  }

  const legacyContainer = root.querySelector(".directory");
  (legacyContainer ?? root).appendChild(footer);
  return footer;
}