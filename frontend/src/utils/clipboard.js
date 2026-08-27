import renderMarkdown from "./chat/markdown";

/**
 * Copy plain text in secure and non-secure browser contexts.
 * navigator.clipboard is unavailable on plain HTTP in browsers such as
 * Firefox, so retain execCommand as a compatibility fallback.
 * @param {string} text - Text to copy.
 * @returns {Promise<boolean>}
 */
export async function copyTextToClipboard(text) {
  const value = String(text ?? "");

  if (window.navigator.clipboard?.writeText) {
    try {
      await window.navigator.clipboard.writeText(value);
      return true;
    } catch {
      // A browser permission policy can reject the modern API even when it is
      // present. Fall through while the click still has user activation.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    if (!document.execCommand("copy"))
      throw new Error("The browser rejected the clipboard operation.");
    return true;
  } finally {
    textarea.remove();
  }
}

/**
 * Copies the given markdown string as rich text to the clipboard.
 * @param {string} markdownString - The markdown string to copy.
 * @returns {Promise<void>}
 */
export async function copyMarkdownAsRichText(markdownString) {
  try {
    const htmlContent = renderMarkdown(markdownString);
    const blobHTML = new Blob([htmlContent], { type: "text/html" });
    const blobText = new Blob([markdownString], { type: "text/plain" });

    const data = [
      new ClipboardItem({
        "text/html": blobHTML,
        "text/plain": blobText,
      }),
    ];

    await navigator.clipboard.write(data);
  } catch (error) {
    console.error("Failed to copy markdown as rich text: ", error);
  }
}
