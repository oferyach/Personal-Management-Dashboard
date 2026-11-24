"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Dictionary } from "@/i18n/dictionaries/types";
import { authClient } from "@/lib/authClient";

/** Localized copy handed down by the server page — the client never translates. */
type LoginCopy = Dictionary["auth"]["login"];

/**
 * Better Auth's measured error codes → localized message, with the raw code kept
 * visible as a machine island so an operator can match a log line to a screen.
 */
function messageFor(
  code: string | undefined,
  status: number,
  copy: LoginCopy,
): { text: string; machineCode: string } {
  switch (code) {
    case "INVALID_EMAIL_OR_PASSWORD":
    case "USER_NOT_FOUND":
    case "INVALID_PASSWORD":
      return { text: copy.errors.invalidCredentials, machineCode: code };
    case "TOO_MANY_REQUESTS":
    case "RATE_LIMIT_EXCEEDED":
      return { text: copy.errors.rateLimited, machineCode: code };
    case "VALIDATION_ERROR":
      return { text: copy.errors.validation, machineCode: code };
    case "BANISHED":
    case "USER_BANNED":
      return { text: copy.reasons.banned, machineCode: code };
    default:
      return { text: copy.errors.unknown, machineCode: code ?? `HTTP_${status}` };
  }
}

export function LoginForm({ copy }: { copy: LoginCopy }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ text: string; machineCode: string } | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    setPending(true);
    setError(null);

    try {
      const result = await authClient.signIn.email({ email, password });

      if (result.error) {
        setError(messageFor(result.error.code, result.error.status, copy));
        setPending(false);
        return;
      }

      // Measured 1.7.27 shape of a 2FA-required sign-in (proved in Gate 1 spike):
      // no session is issued, the body says to continue at the second-factor step.
      // When twoFactorMethods is present (enrolled), go to the verification page;
      // otherwise (unenrolled) go to the dashboard — the shell will redirect to
      // the security settings for enrollment.
      const data = result.data as { twoFactorRedirect?: boolean; twoFactorMethods?: string[] } | null;
      if (data?.twoFactorRedirect) {
        if (data?.twoFactorMethods && data.twoFactorMethods.length > 0) {
          router.push("/two-factor/verify");
        } else {
          router.push("/");
        }
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError({ text: copy.errors.network, machineCode: "NETWORK_ERROR" });
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <label htmlFor="email" className="text-muted-foreground block text-sm">
          {copy.email}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="border-border bg-background mt-1 w-full rounded-(--radius-card) border px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label htmlFor="password" className="text-muted-foreground block text-sm">
          {copy.password}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="border-border bg-background mt-1 w-full rounded-(--radius-card) border px-3 py-2 text-sm"
        />
      </div>

      {error ? (
        <p
          className="border-warning/40 bg-warning/10 rounded-(--radius-card) border px-3 py-2 text-sm"
          role="alert"
          data-error-code={error.machineCode}
        >
          {error.text}{" "}
          <span className="text-muted-foreground ltr-island font-mono text-xs" dir="ltr">
            {error.machineCode}
          </span>
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="bg-accent text-accent-foreground rounded-(--radius-card) px-4 py-2 text-sm font-semibold disabled:opacity-60"
      >
        {pending ? copy.signingIn : copy.submit}
      </button>
    </form>
  );
}
