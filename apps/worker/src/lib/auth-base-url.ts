import type { Env } from "../types";

export function getAuthBaseURL(env: Env, requestUrl: string) {
  if (env.ENVIRONMENT === "development") {
    return "http://localhost:8787";
  }

  const url = new URL(requestUrl);
  const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (!isLocalhost && url.protocol === "http:") {
    url.protocol = "https:";
  }

  return url.origin;
}
