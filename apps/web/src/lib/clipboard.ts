/**
 * Copy text. `navigator.clipboard` only exists on HTTPS (or localhost), so on
 * plain http://IP:port hosting fall back to a hidden textarea + execCommand.
 */
export async function copyText(text: string): Promise<void> {
  if (window.isSecureContext && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  try {
    if (!document.execCommand("copy")) throw new Error("Copy failed");
  } finally {
    area.remove();
  }
}
