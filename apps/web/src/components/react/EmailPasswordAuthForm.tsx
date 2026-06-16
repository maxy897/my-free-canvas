import { FormEvent, useState } from "react";
import {
  signInOrCreateWithEmailPassword,
  signUpWithEmailPassword,
} from "../../lib/auth-client";

interface EmailPasswordAuthFormProps {
  mode: "login" | "register";
  callbackURL?: string;
}

function getDefaultName(email: string) {
  return email.split("@")[0]?.trim() || "Free Canvas User";
}

export default function EmailPasswordAuthForm({
  mode,
  callbackURL = "/dashboard",
}: EmailPasswordAuthFormProps) {
  const isRegister = mode === "register";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Please enter your email.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (isRegister && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (isRegister) {
        await signUpWithEmailPassword(
          normalizedEmail,
          password,
          name.trim() || getDefaultName(normalizedEmail),
          callbackURL
        );
      } else {
        await signInOrCreateWithEmailPassword(
          normalizedEmail,
          password,
          getDefaultName(normalizedEmail),
          callbackURL
        );
      }
      window.location.assign(callbackURL);
    } catch (authError) {
      setError(
        authError instanceof Error
          ? authError.message
          : "Authentication failed. Please try again."
      );
      setIsSubmitting(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      {isRegister && (
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-[#B8C0CC]">
            Display name
          </span>
          <input
            type="text"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Free Canvas User"
            className="w-full rounded-2xl border border-[#2B313B] bg-[#0B0D12] px-4 py-3 text-sm text-[#F5F7FA] outline-none transition placeholder:text-[#5F6B7A] focus:border-[#28D7F5]/70"
          />
        </label>
      )}

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-[#B8C0CC]">
          Email
        </span>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-2xl border border-[#2B313B] bg-[#0B0D12] px-4 py-3 text-sm text-[#F5F7FA] outline-none transition placeholder:text-[#5F6B7A] focus:border-[#28D7F5]/70"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-[#B8C0CC]">
          Password
        </span>
        <input
          type="password"
          autoComplete={isRegister ? "new-password" : "current-password"}
          required
          minLength={8}
          maxLength={128}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="At least 8 characters"
          className="w-full rounded-2xl border border-[#2B313B] bg-[#0B0D12] px-4 py-3 text-sm text-[#F5F7FA] outline-none transition placeholder:text-[#5F6B7A] focus:border-[#28D7F5]/70"
        />
      </label>

      {isRegister && (
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-[#B8C0CC]">
            Confirm password
          </span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Repeat your password"
            className="w-full rounded-2xl border border-[#2B313B] bg-[#0B0D12] px-4 py-3 text-sm text-[#F5F7FA] outline-none transition placeholder:text-[#5F6B7A] focus:border-[#28D7F5]/70"
          />
        </label>
      )}

      {error && (
        <p className="rounded-2xl border border-[#FF6B6B]/30 bg-[#FF6B6B]/10 px-4 py-3 text-sm text-[#FFB4B4]">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-full bg-[#F5F7FA] px-4 py-3 text-sm font-semibold text-[#050608] shadow-[0_0_28px_rgba(245,247,250,0.16)] transition hover:bg-white disabled:cursor-wait disabled:opacity-70"
      >
        {isSubmitting
          ? isRegister
            ? "Creating account..."
            : "Signing in..."
          : isRegister
            ? "Create account"
            : "Sign in"}
      </button>

      <p className="text-center text-xs text-[#788493]">
        {isRegister ? (
          <>
            Already have an account?{" "}
            <a className="text-[#28D7F5] hover:text-[#7CEBFF]" href="/auth/login">
              Sign in
            </a>
          </>
        ) : (
          <>
            New here?{" "}
            <a className="text-[#28D7F5] hover:text-[#7CEBFF]" href="/auth/register">
              Create an account
            </a>
          </>
        )}
      </p>
    </form>
  );
}
