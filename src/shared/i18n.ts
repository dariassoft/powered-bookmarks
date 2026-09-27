export function getMessage(messageName: string): string {
  const message = chrome.i18n.getMessage(messageName);

  if (!message) {
    throw new Error(`Missing i18n message: ${messageName}`);
  }

  return message;
}

export function applyTranslations(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    const messageName = element.dataset.i18n;

    if (!messageName) {
      return;
    }

    element.textContent = getMessage(messageName);
  });

  root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((element) => {
    const messageName = element.dataset.i18nPlaceholder;

    if (!messageName) {
      return;
    }

    element.placeholder = getMessage(messageName);
  });

  root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]').forEach((element) => {
    const messageName = element.dataset.i18nAriaLabel;

    if (!messageName) {
      return;
    }

    element.setAttribute('aria-label', getMessage(messageName));
  });
}
