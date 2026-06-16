const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID") || "";

/**
 * Upload a file to Telegram via Bot API.
 * Returns the file_id for persistent storage.
 */
export async function uploadToTelegram(
  data: Uint8Array,
  mimeType: string,
  filename?: string
): Promise<string> {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn("[telegram] BOT_TOKEN or CHAT_ID not configured, skipping upload");
    return "";
  }

  const formData = new FormData();
  formData.append("chat_id", CHAT_ID);

  // Create blob from the data - deno-lint-ignore no-explicit-any
  const blob = new Blob([data] as any, {
    type: mimeType,
  });
  const name = filename || `file_${Date.now()}.${mimeType.split("/")[1] || "bin"}`;

  if (mimeType.startsWith("image/")) {
    formData.append("photo", blob, name);
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      body: formData,
    });
    const json = (await res.json()) as {
      ok: boolean;
      result?: { photo?: { file_id: string }[] };
    };
    if (!json.ok || !json.result?.photo?.length) {
      throw new Error("Telegram photo upload failed");
    }
    // Return the largest photo's file_id
    return json.result.photo[json.result.photo.length - 1].file_id;
  } else {
    formData.append("document", blob, name);
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
      method: "POST",
      body: formData,
    });
    const json = (await res.json()) as {
      ok: boolean;
      result?: { document?: { file_id: string } };
    };
    if (!json.ok || !json.result?.document) {
      throw new Error("Telegram document upload failed");
    }
    return json.result.document.file_id;
  }
}
