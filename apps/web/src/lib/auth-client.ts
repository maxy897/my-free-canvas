import { createAuthClient } from "better-auth/react";
import { genericOAuthClient } from "better-auth/client/plugins";

const API_URL = import.meta.env.PUBLIC_API_URL || "http://localhost:8787";
const GENERIC_OAUTH_PROVIDERS = new Set(["linuxdo"]);

export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [genericOAuthClient()],
  fetchOptions: {
    credentials: "include",
  },
});

export const { signIn, signOut, useSession } = authClient;

interface AuthClientError {
  message?: string;
  code?: string;
}

class AuthClientRequestError extends Error {
  code?: string;

  constructor(error: AuthClientError) {
    super(error.message || error.code || "Authentication failed");
    this.name = "AuthClientRequestError";
    this.code = error.code;
  }
}

function assertAuthSuccess<T extends { error?: AuthClientError | null }>(result: T): T {
  if (result.error) {
    throw new AuthClientRequestError(result.error);
  }
  return result;
}

function isAuthClientRequestError(error: unknown): error is AuthClientRequestError {
  return error instanceof AuthClientRequestError;
}

function isExistingAccountError(error: unknown): boolean {
  const authError = error as Partial<AuthClientRequestError> | undefined;
  const value = `${authError?.code || ""} ${authError?.message || ""}`.toLowerCase();

  return (
    value.includes("user_already_exists") ||
    value.includes("email_already_exists") ||
    value.includes("already exists") ||
    value.includes("already registered")
  );
}

export interface OAuthProvider {
  provider: string;
  name: string;
  icon: string;
}

function toAbsoluteCallbackURL(callbackURL: string): string {
  return callbackURL.startsWith("http")
    ? callbackURL
    : `${window.location.origin}${callbackURL}`;
}

export async function getAvailableProviders(): Promise<OAuthProvider[]> {
  const response = await fetch(`${API_URL}/api/auth/providers`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Failed to fetch auth providers");
  }
  const data = await response.json();
  return data.providers || [];
}

export async function signInWithOAuthProvider(
  provider: string,
  callbackURL = "/dashboard"
) {
  const absoluteCallbackURL = toAbsoluteCallbackURL(callbackURL);

  if (GENERIC_OAUTH_PROVIDERS.has(provider)) {
    return authClient.signIn.oauth2({
      providerId: provider,
      callbackURL: absoluteCallbackURL,
    });
  }

  return signIn.social({
    provider: provider as any,
    callbackURL: absoluteCallbackURL,
  });
}

export async function signInWithEmailPassword(
  email: string,
  password: string,
  callbackURL = "/dashboard"
) {
  return assertAuthSuccess(
    await authClient.signIn.email({
      email,
      password,
      callbackURL: toAbsoluteCallbackURL(callbackURL),
      rememberMe: true,
    })
  );
}

export async function signUpWithEmailPassword(
  email: string,
  password: string,
  name: string,
  callbackURL = "/dashboard"
) {
  return assertAuthSuccess(
    await authClient.signUp.email({
      email,
      password,
      name,
      callbackURL: toAbsoluteCallbackURL(callbackURL),
    })
  );
}

export async function signInOrCreateWithEmailPassword(
  email: string,
  password: string,
  name: string,
  callbackURL = "/dashboard"
) {
  let signInError: unknown;

  try {
    return await signInWithEmailPassword(email, password, callbackURL);
  } catch (error) {
    if (!isAuthClientRequestError(error)) {
      throw error;
    }
    signInError = error;
  }

  try {
    return await signUpWithEmailPassword(email, password, name, callbackURL);
  } catch (signUpError) {
    if (isExistingAccountError(signUpError)) {
      throw signInError;
    }
    throw signUpError;
  }
}

export async function signOutAndRedirect(callbackURL = "/") {
  await signOut();
  window.location.assign(callbackURL);
}
