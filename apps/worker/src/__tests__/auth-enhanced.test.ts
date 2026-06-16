import { describe, it, expect, beforeEach } from "vitest";
import {
  buildLinuxDoSyntheticEmail,
  buildOAuthConfig,
  getAvailableProviders,
  mapLinuxDoUserInfo,
} from "../lib/auth-enhanced";
import type { Env } from "../types";

describe("Authentication Enhancement", () => {
  let mockEnv: Partial<Env>;

  beforeEach(() => {
    mockEnv = {
      ENVIRONMENT: "development",
      FRONTEND_URL: "http://localhost:4321",
      BETTER_AUTH_SECRET: "test-secret",
    };
  });

  describe("buildOAuthConfig", () => {
    it("should build config with Google OAuth", () => {
      mockEnv.GOOGLE_CLIENT_ID = "google-client-id";
      mockEnv.GOOGLE_CLIENT_SECRET = "google-secret";

      const config = buildOAuthConfig(mockEnv as Env, "http://localhost:8787");

      expect(config.google?.enabled).toBe(true);
      expect(config.google?.clientId).toBe("google-client-id");
      expect(config.google?.clientSecret).toBe("google-secret");
      expect(config.google?.redirectURI).toBe(
        "http://localhost:8787/api/auth/callback/google"
      );
    });

    it("should build config with GitHub OAuth", () => {
      mockEnv.GITHUB_CLIENT_ID = "github-client-id";
      mockEnv.GITHUB_CLIENT_SECRET = "github-secret";

      const config = buildOAuthConfig(mockEnv as Env, "http://localhost:8787");

      expect(config.github?.enabled).toBe(true);
      expect(config.github?.clientId).toBe("github-client-id");
      expect(config.github?.clientSecret).toBe("github-secret");
      expect(config.github?.redirectURI).toBe(
        "http://localhost:8787/api/auth/callback/github"
      );
    });

    it("should build config with Microsoft OAuth", () => {
      mockEnv.MICROSOFT_CLIENT_ID = "microsoft-client-id";
      mockEnv.MICROSOFT_CLIENT_SECRET = "microsoft-secret";

      const config = buildOAuthConfig(mockEnv as Env, "http://localhost:8787");

      expect(config.microsoft?.enabled).toBe(true);
      expect(config.microsoft?.clientId).toBe("microsoft-client-id");
      expect(config.microsoft?.clientSecret).toBe("microsoft-secret");
      expect(config.microsoft?.redirectURI).toBe(
        "http://localhost:8787/api/auth/callback/microsoft"
      );
    });

    it("should build config with Discord OAuth", () => {
      mockEnv.DISCORD_CLIENT_ID = "discord-client-id";
      mockEnv.DISCORD_CLIENT_SECRET = "discord-secret";

      const config = buildOAuthConfig(mockEnv as Env, "http://localhost:8787");

      expect(config.discord?.enabled).toBe(true);
      expect(config.discord?.clientId).toBe("discord-client-id");
      expect(config.discord?.clientSecret).toBe("discord-secret");
      expect(config.discord?.redirectURI).toBe(
        "http://localhost:8787/api/auth/callback/discord"
      );
    });

    it("should build config with LinuxDo OAuth", () => {
      mockEnv.LINUXDO_CLIENT_ID = "linuxdo-client-id";
      mockEnv.LINUXDO_CLIENT_SECRET = "linuxdo-secret";

      const config = buildOAuthConfig(mockEnv as Env, "http://localhost:8787");

      expect(config.linuxdo?.enabled).toBe(true);
      expect(config.linuxdo?.clientId).toBe("linuxdo-client-id");
      expect(config.linuxdo?.clientSecret).toBe("linuxdo-secret");
      expect(config.linuxdo?.redirectURI).toBe(
        "http://localhost:8787/api/auth/oauth2/callback/linuxdo"
      );
      expect(config.linuxdo?.scope).toEqual(["user"]);
    });

    it("should support LinuxDo OAuth overrides", () => {
      mockEnv.LINUXDO_CLIENT_ID = "linuxdo-client-id";
      mockEnv.LINUXDO_CLIENT_SECRET = "linuxdo-secret";
      mockEnv.LINUXDO_REDIRECT_URI = "https://example.com/auth/linuxdo/callback";
      mockEnv.LINUXDO_SCOPES = "user profile";

      const config = buildOAuthConfig(mockEnv as Env, "http://localhost:8787");

      expect(config.linuxdo?.redirectURI).toBe(
        "https://example.com/auth/linuxdo/callback"
      );
      expect(config.linuxdo?.scope).toEqual(["user", "profile"]);
    });

    it("should build config with multiple providers", () => {
      mockEnv.GOOGLE_CLIENT_ID = "google-id";
      mockEnv.GOOGLE_CLIENT_SECRET = "google-secret";
      mockEnv.GITHUB_CLIENT_ID = "github-id";
      mockEnv.GITHUB_CLIENT_SECRET = "github-secret";

      const config = buildOAuthConfig(mockEnv as Env, "http://localhost:8787");

      expect(config.google?.enabled).toBe(true);
      expect(config.github?.enabled).toBe(true);
      expect(config.microsoft?.enabled).toBeUndefined();
      expect(config.discord?.enabled).toBeUndefined();
    });

    it("should skip providers without credentials", () => {
      // Only set partial credentials - should not be enabled
      mockEnv.GOOGLE_CLIENT_ID = "google-id";
      // Missing GOOGLE_CLIENT_SECRET

      const config = buildOAuthConfig(mockEnv as Env, "http://localhost:8787");

      expect(config.google?.enabled).toBeUndefined();
    });

    it("should skip LinuxDo without client secret", () => {
      mockEnv.LINUXDO_CLIENT_ID = "linuxdo-id";

      const config = buildOAuthConfig(mockEnv as Env, "http://localhost:8787");

      expect(config.linuxdo?.enabled).toBeUndefined();
    });

    it("should generate correct redirect URIs", () => {
      mockEnv.GOOGLE_CLIENT_ID = "google-id";
      mockEnv.GOOGLE_CLIENT_SECRET = "google-secret";

      const config = buildOAuthConfig(
        mockEnv as Env,
        "https://canvas.example.com"
      );

      expect(config.google?.redirectURI).toBe(
        "https://canvas.example.com/api/auth/callback/google"
      );
    });
  });

  describe("getAvailableProviders", () => {
    it("should return empty list when no providers configured", () => {
      const providers = getAvailableProviders(mockEnv as Env);
      expect(providers).toEqual([]);
    });

    it("should return Google when configured", () => {
      mockEnv.GOOGLE_CLIENT_ID = "google-id";
      mockEnv.GOOGLE_CLIENT_SECRET = "google-secret";

      const providers = getAvailableProviders(mockEnv as Env);

      expect(providers).toContainEqual({
        provider: "google",
        name: "Google",
        icon: "google",
      });
    });

    it("should return GitHub when configured", () => {
      mockEnv.GITHUB_CLIENT_ID = "github-id";
      mockEnv.GITHUB_CLIENT_SECRET = "github-secret";

      const providers = getAvailableProviders(mockEnv as Env);

      expect(providers).toContainEqual({
        provider: "github",
        name: "GitHub",
        icon: "github",
      });
    });

    it("should return Microsoft when configured", () => {
      mockEnv.MICROSOFT_CLIENT_ID = "microsoft-id";
      mockEnv.MICROSOFT_CLIENT_SECRET = "microsoft-secret";

      const providers = getAvailableProviders(mockEnv as Env);

      expect(providers).toContainEqual({
        provider: "microsoft",
        name: "Microsoft",
        icon: "microsoft",
      });
    });

    it("should return Discord when configured", () => {
      mockEnv.DISCORD_CLIENT_ID = "discord-id";
      mockEnv.DISCORD_CLIENT_SECRET = "discord-secret";

      const providers = getAvailableProviders(mockEnv as Env);

      expect(providers).toContainEqual({
        provider: "discord",
        name: "Discord",
        icon: "discord",
      });
    });

    it("should return LinuxDo when configured", () => {
      mockEnv.LINUXDO_CLIENT_ID = "linuxdo-id";
      mockEnv.LINUXDO_CLIENT_SECRET = "linuxdo-secret";

      const providers = getAvailableProviders(mockEnv as Env);

      expect(providers).toContainEqual({
        provider: "linuxdo",
        name: "LinuxDo",
        icon: "linuxdo",
      });
    });

    it("should return Google and LinuxDo when both are configured", () => {
      mockEnv.GOOGLE_CLIENT_ID = "google-id";
      mockEnv.GOOGLE_CLIENT_SECRET = "google-secret";
      mockEnv.LINUXDO_CLIENT_ID = "linuxdo-id";
      mockEnv.LINUXDO_CLIENT_SECRET = "linuxdo-secret";

      const providers = getAvailableProviders(mockEnv as Env);

      expect(providers.map((p) => p.provider)).toEqual(["google", "linuxdo"]);
    });

    it("should hide providers without complete credentials", () => {
      mockEnv.GOOGLE_CLIENT_ID = "google-id";
      mockEnv.LINUXDO_CLIENT_SECRET = "linuxdo-secret";

      const providers = getAvailableProviders(mockEnv as Env);

      expect(providers).toEqual([]);
    });

    it("should return all configured providers", () => {
      mockEnv.GOOGLE_CLIENT_ID = "google-id";
      mockEnv.GOOGLE_CLIENT_SECRET = "google-secret";
      mockEnv.GITHUB_CLIENT_ID = "github-id";
      mockEnv.GITHUB_CLIENT_SECRET = "github-secret";
      mockEnv.MICROSOFT_CLIENT_ID = "microsoft-id";
      mockEnv.MICROSOFT_CLIENT_SECRET = "microsoft-secret";
      mockEnv.DISCORD_CLIENT_ID = "discord-id";
      mockEnv.DISCORD_CLIENT_SECRET = "discord-secret";

      const providers = getAvailableProviders(mockEnv as Env);

      expect(providers).toHaveLength(4);
      expect(providers.map((p) => p.provider)).toContainEqual("google");
      expect(providers.map((p) => p.provider)).toContainEqual("github");
      expect(providers.map((p) => p.provider)).toContainEqual("microsoft");
      expect(providers.map((p) => p.provider)).toContainEqual("discord");
    });

    it("should return providers in order", () => {
      mockEnv.DISCORD_CLIENT_ID = "discord-id"; // Set in different order
      mockEnv.DISCORD_CLIENT_SECRET = "discord-secret";
      mockEnv.GITHUB_CLIENT_ID = "github-id";
      mockEnv.GITHUB_CLIENT_SECRET = "github-secret";
      mockEnv.GOOGLE_CLIENT_ID = "google-id";
      mockEnv.GOOGLE_CLIENT_SECRET = "google-secret";

      const providers = getAvailableProviders(mockEnv as Env);

      // Verify order: Google, GitHub, Microsoft, Discord
      expect(providers[0].provider).toBe("google");
      expect(providers[1].provider).toBe("github");
      expect(providers[2].provider).toBe("discord");
    });
  });

  describe("OAuth Configuration Validation", () => {
    it("should handle missing environment variables gracefully", () => {
      const config = buildOAuthConfig(mockEnv as Env, "http://localhost:8787");

      // Should have empty oauth config
      expect(Object.keys(config).length).toBe(0);
    });

    it("should validate redirect URIs have protocol", () => {
      mockEnv.GOOGLE_CLIENT_ID = "google-id";
      mockEnv.GOOGLE_CLIENT_SECRET = "google-secret";

      const config = buildOAuthConfig(mockEnv as Env, "https://example.com");

      expect(config.google?.redirectURI).toMatch(/^https:\/\//);
    });

    it("should support multiple trusted origins parsing", () => {
      mockEnv.ADDITIONAL_TRUSTED_ORIGINS =
        "https://custom.example.com,https://old.example.com";

      // Simulate parsing
      const origins = mockEnv.ADDITIONAL_TRUSTED_ORIGINS.split(",").map((url) =>
        url.trim()
      );

      expect(origins).toHaveLength(2);
      expect(origins).toContain("https://custom.example.com");
      expect(origins).toContain("https://old.example.com");
    });
  });

  describe("Provider Icon and Display Names", () => {
    it("should provide consistent provider information", () => {
      mockEnv.GOOGLE_CLIENT_ID = "google-id";
      mockEnv.GOOGLE_CLIENT_SECRET = "google-secret";
      mockEnv.GITHUB_CLIENT_ID = "github-id";
      mockEnv.GITHUB_CLIENT_SECRET = "github-secret";
      mockEnv.MICROSOFT_CLIENT_ID = "microsoft-id";
      mockEnv.MICROSOFT_CLIENT_SECRET = "microsoft-secret";
      mockEnv.DISCORD_CLIENT_ID = "discord-id";
      mockEnv.DISCORD_CLIENT_SECRET = "discord-secret";

      const providers = getAvailableProviders(mockEnv as Env);

      // Verify all providers have icon field
      providers.forEach((provider) => {
        expect(provider.icon).toBeDefined();
        expect(provider.name).toBeDefined();
        expect(provider.provider).toBeDefined();
      });
    });
  });

  describe("LinuxDo userinfo mapping", () => {
    it("should generate stable synthetic email from LinuxDo subject", () => {
      expect(buildLinuxDoSyntheticEmail("User:123")).toBe(
        "linuxdo-user-123@linuxdo-connect.invalid"
      );
    });

    it("should map LinuxDo userinfo with top-level fields", () => {
      const userInfo = mapLinuxDoUserInfo({
        sub: "12345",
        username: "linuxdo-user",
        avatar_url: "https://example.com/avatar.png",
      });

      expect(userInfo).toEqual({
        id: "12345",
        email: "linuxdo-12345@linuxdo-connect.invalid",
        name: "linuxdo-user",
        image: "https://example.com/avatar.png",
        emailVerified: false,
      });
    });

    it("should map LinuxDo userinfo with nested user fields", () => {
      const userInfo = mapLinuxDoUserInfo({
        user: {
          id: 6789,
          name: "Nested User",
          image: "https://example.com/nested.png",
        },
      });

      expect(userInfo?.id).toBe("6789");
      expect(userInfo?.email).toBe("linuxdo-6789@linuxdo-connect.invalid");
      expect(userInfo?.name).toBe("Nested User");
      expect(userInfo?.image).toBe("https://example.com/nested.png");
    });

    it("should reject LinuxDo userinfo without subject", () => {
      expect(mapLinuxDoUserInfo({ username: "missing-subject" })).toBeNull();
    });
  });
});
