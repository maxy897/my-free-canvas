import { createAuthClient } from "better-auth/react";
import { genericOAuthClient } from "better-auth/client/plugins";
import { useEffect, useState } from "react";

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

/**
 * Available OAuth providers
 */
export interface OAuthProvider {
  provider: string;
  name: string;
  icon: string;
}

/**
 * Hook to get available OAuth providers
 */
export function useAvailableProviders() {
  const [providers, setProviders] = useState<OAuthProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const response = await fetch(`${API_URL}/api/auth/providers`, {
          credentials: "include",
        });
        if (!response.ok) throw new Error("Failed to fetch providers");
        const data = await response.json();
        setProviders(data.providers || []);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };

    fetchProviders();
  }, []);

  return { providers, loading, error };
}

/**
 * Sign in with OAuth provider
 */
export async function signInWithProvider(provider: string) {
  try {
    if (GENERIC_OAUTH_PROVIDERS.has(provider)) {
      return await authClient.signIn.oauth2({
        providerId: provider,
        callbackURL: `${window.location.origin}/`,
      });
    }

    return await signIn.social({
      provider: provider as any,
      callbackURL: `${window.location.origin}/`,
    });
  } catch (error) {
    console.error(`Sign in with ${provider} failed:`, error);
    throw error;
  }
}

/**
 * Sign in with email and password (local auth)
 */
export async function signInWithEmail(email: string, password: string) {
  try {
    const result = await authClient.signIn.email({
      email,
      password,
    });
    if (result.error) {
      throw new Error(result.error.message || "Sign in failed");
    }
    return result;
  } catch (error) {
    console.error("Sign in with email failed:", error);
    throw error;
  }
}

/**
 * Sign up with email and password
 */
export async function signUpWithEmail(
  email: string,
  password: string,
  name?: string
) {
  try {
    const result = await authClient.signUp.email({
      email,
      password,
      name: name || email.split("@")[0] || "Free Canvas User",
    });
    if (result.error) {
      throw new Error(result.error.message || "Sign up failed");
    }
    return result;
  } catch (error) {
    console.error("Sign up failed:", error);
    throw error;
  }
}

/**
 * Get OAuth provider icon URL
 */
export function getProviderIcon(
  provider: string
): string {
  const iconMap: Record<string, string> = {
    google: "https://www.google.com/favicon.ico",
    github: "https://github.com/favicon.ico",
    microsoft:
      "https://www.microsoft.com/favicon.ico",
    discord:
      "https://discord.com/assets/847541504914fd33810e70a0ea73177e.ico",
    linuxdo: "https://linux.do/favicon.ico",
  };
  return iconMap[provider] || "";
}

/**
 * Get provider display name
 */
export function getProviderDisplayName(provider: string): string {
  const nameMap: Record<string, string> = {
    google: "Google",
    github: "GitHub",
    microsoft: "Microsoft",
    discord: "Discord",
    linuxdo: "LinuxDo",
  };
  return nameMap[provider] || provider;
}

/**
 * Check if user has linked a provider
 */
export function isProviderLinked(
  userAccounts: any[] | undefined,
  provider: string
): boolean {
  if (!userAccounts) return false;
  return userAccounts.some((account) => account.provider === provider);
}

/**
 * Link additional OAuth provider to account
 */
export async function linkProvider(provider: string) {
  try {
    if (GENERIC_OAUTH_PROVIDERS.has(provider)) {
      return await authClient.oauth2.link({
        providerId: provider,
        callbackURL: `${window.location.origin}/settings`,
      });
    }

    return await signIn.social({
      provider: provider as any,
      callbackURL: `${window.location.origin}/settings`,
    });
  } catch (error) {
    console.error(`Linking ${provider} failed:`, error);
    throw error;
  }
}

/**
 * Unlink OAuth provider from account
 */
export async function unlinkProvider(provider: string) {
  try {
    const response = await fetch(
      `${API_URL}/api/auth/link-account?provider=${provider}`,
      {
        method: "DELETE",
        credentials: "include",
      }
    );
    if (!response.ok) throw new Error("Failed to unlink provider");
    return await response.json();
  } catch (error) {
    console.error(`Unlinking ${provider} failed:`, error);
    throw error;
  }
}
