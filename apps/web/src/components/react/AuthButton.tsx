import { useEffect, useRef, useState } from "react";
import {
  getAvailableProviders,
  signInWithOAuthProvider,
  signOutAndRedirect,
  useSession,
  type OAuthProvider,
} from "../../lib/auth-client";
import CreditBalance from "./CreditBalance";

interface AuthButtonProps {
  callbackURL?: string;
  signInLabel?: string;
  compact?: boolean;
  showCanvasLink?: boolean;
  showEmailLink?: boolean;
}

export default function AuthButton({
  callbackURL = "/dashboard",
  signInLabel = "Sign in",
  compact = false,
  showCanvasLink = false,
  showEmailLink = true,
}: AuthButtonProps) {
  const { data: session, isPending } = useSession();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [providers, setProviders] = useState<OAuthProvider[]>([]);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [signingInProvider, setSigningInProvider] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    getAvailableProviders()
      .then((availableProviders) => {
        if (!cancelled) setProviders(availableProviders);
      })
      .catch((error) => {
        console.error("Failed to load auth providers:", error);
      })
      .finally(() => {
        if (!cancelled) setProvidersLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  if (isPending || !providersLoaded) {
    return (
      <div
        className={`animate-pulse rounded-full border border-[#2B313B] bg-[#1D2129] ${
          compact ? "h-8 w-20" : "h-9 w-24"
        }`}
      />
    );
  }

  if (session?.user) {
    const avatarSize = compact ? "h-7 w-7" : "h-8 w-8";

    return (
      <div className={compact ? "flex items-center gap-2" : "flex items-center gap-3"}>
        {showCanvasLink && (
          <a
            href="/canvas"
            className="rounded-full px-3 py-1.5 text-sm text-[#B8C0CC] hover:bg-[#1D2129] hover:text-[#F5F7FA]"
          >
            Canvas
          </a>
        )}
        <CreditBalance />
        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen((open) => !open)}
            className={`${avatarSize} overflow-hidden rounded-full border border-[#3C4654] bg-[#1D2129] text-sm font-semibold text-[#F5F7FA] hover:border-[#28D7F5]/70`}
          >
            {session.user.image ? (
              <img src={session.user.image} alt="" className="h-full w-full object-cover" />
            ) : (
              <span>{session.user.name?.charAt(0).toUpperCase() || "U"}</span>
            )}
          </button>
          {isMenuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-50 mt-2 min-w-32 rounded-2xl border border-[#2B313B] bg-[#14171D]/96 p-1 shadow-[0_18px_50px_rgba(0,0,0,0.38)] backdrop-blur-xl"
            >
              <button
                type="button"
                role="menuitem"
                disabled={isSigningOut}
                onClick={async () => {
                  setIsMenuOpen(false);
                  setIsSigningOut(true);
                  try {
                    await signOutAndRedirect();
                  } catch (error) {
                    console.error("Sign out failed:", error);
                    setIsSigningOut(false);
                  }
                }}
                className="block w-full rounded-xl px-3 py-2 text-left text-sm text-[#B8C0CC] hover:bg-[#1D2129] hover:text-[#F5F7FA] disabled:cursor-wait disabled:opacity-60"
              >
                {isSigningOut ? "Signing out..." : "Sign out"}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const fallbackProvider = { provider: "google", name: "Google", icon: "google" };
  const orderedProviders = (providers.length ? [...providers] : [fallbackProvider]).sort(
    (a, b) => {
      if (a.provider === "google") return -1;
      if (b.provider === "google") return 1;
      return 0;
    }
  );

  return (
    <div ref={menuRef} className="relative inline-flex">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        disabled={Boolean(signingInProvider)}
        onClick={() => setIsMenuOpen((open) => !open)}
        className={`rounded-full bg-[#F5F7FA] text-sm font-semibold text-[#050608] shadow-[0_0_28px_rgba(245,247,250,0.16)] hover:bg-white disabled:cursor-wait disabled:opacity-70 ${
          compact ? "px-4 py-1.5" : "px-4 py-2.5"
        }`}
      >
        {signingInProvider ? "Signing in..." : compact ? "Sign in" : signInLabel}
      </button>

      {isMenuOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full z-[100] mt-2 min-w-44 rounded-2xl border border-[#2B313B] bg-[#14171D]/96 p-1 shadow-[0_18px_50px_rgba(0,0,0,0.38)] backdrop-blur-xl"
        >
          {showEmailLink && (
            <a
              href="/auth/login"
              role="menuitem"
              className="block w-full rounded-xl px-3 py-2 text-left text-sm text-[#B8C0CC] hover:bg-[#1D2129] hover:text-[#F5F7FA]"
            >
              Sign in with email
            </a>
          )}
          {orderedProviders.map((provider) => {
            const isSigningIn = signingInProvider === provider.provider;

            return (
              <button
                key={provider.provider}
                type="button"
                role="menuitem"
                disabled={Boolean(signingInProvider)}
                onClick={async () => {
                  setSigningInProvider(provider.provider);
                  try {
                    await signInWithOAuthProvider(provider.provider, callbackURL);
                  } catch (error) {
                    console.error(`Sign in with ${provider.name} failed:`, error);
                    setSigningInProvider(null);
                    setIsMenuOpen(false);
                  }
                }}
                className="block w-full rounded-xl px-3 py-2 text-left text-sm text-[#B8C0CC] hover:bg-[#1D2129] hover:text-[#F5F7FA] disabled:cursor-wait disabled:opacity-60"
              >
                {isSigningIn ? "Signing in..." : `Sign in with ${provider.name}`}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
