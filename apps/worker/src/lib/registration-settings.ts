import type { Env } from "../types";

const REGISTRATION_SETTING_KEY = "registration_enabled";

export interface RegistrationSettings {
  registrationEnabled: boolean;
  updatedAt: string | null;
}

export async function getRegistrationSettings(env: Env): Promise<RegistrationSettings> {
  try {
    const row = await env.DB.prepare(
      `SELECT "value", "updatedAt" FROM "app_setting" WHERE "key" = ?`
    )
      .bind(REGISTRATION_SETTING_KEY)
      .first<{ value: string; updatedAt: string }>();

    return {
      registrationEnabled: row?.value !== "false",
      updatedAt: row?.updatedAt ?? null,
    };
  } catch (error) {
    console.error("Failed to read registration settings:", error);
    return { registrationEnabled: true, updatedAt: null };
  }
}

export async function setRegistrationEnabled(
  env: Env,
  enabled: boolean
): Promise<RegistrationSettings> {
  await env.DB.prepare(
    `INSERT INTO "app_setting" ("key", "value", "updatedAt")
     VALUES (?, ?, datetime('now'))
     ON CONFLICT("key") DO UPDATE SET
       "value" = excluded."value",
       "updatedAt" = excluded."updatedAt"`
  )
    .bind(REGISTRATION_SETTING_KEY, enabled ? "true" : "false")
    .run();

  return getRegistrationSettings(env);
}

export function isRegistrationDisabledError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("registration_disabled");
}
