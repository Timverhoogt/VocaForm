export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    }
  });

  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error || `Request failed with status ${response.status}.`);
  return payload as T;
}

export async function downloadDraft(): Promise<void> {
  await downloadDocument("/api/export/draft", "vocaform-draft.docx", "The draft could not be created.");
}

export async function downloadVerified(): Promise<void> {
  await downloadDocument(
    "/api/export/final",
    "vocaform-verified.docx",
    "The verified document could not be created."
  );
}

async function downloadDocument(path: string, fallbackName: string, errorMessage: string): Promise<void> {
  const response = await fetch(path, { method: "POST" });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || errorMessage);
  }

  const disposition = response.headers.get("Content-Disposition") || "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] || fallbackName;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
