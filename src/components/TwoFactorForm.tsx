"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Dictionary } from "@/i18n/dictionaries/types";
import { authClient } from "@/lib/authClient";

type TwoFactorCopy = Dictionary["auth"]["twoFactor"];

function messageFor(
  code: string | undefined,
  status: number,
  copy: TwoFactorCopy,
): { text: string; machineCode: string } {
  switch (code) {
    case "INVALID_CODE":
    case "INVALID_BACKUP_CODE":
    case "BACKUP_CODE_NOT_FOUND":
      return { text: copy.errors.invalidCode, machineCode: code };
    case "TOO_MANY_REQUESTS":
    case "RATE_LIMIT_EXCEEDED":
      return { text: copy.errors.locked, machineCode: code };
    default:
      if (status === 401 || status === 403 || code === "TOTP_NOT_ENABLED") {
        return { text: copy.errors.notStarted, machineCode: code ?? `HTTP_${status}` };
      }
      return { text: copy.errors.invalidCode, machineCode: code ?? `HTTP_${status}` };
  }
}

export function TwoFactorForm({ copy }: { copy: TwoFactorCopy }) {
  const router = useRouter();
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ text: string; machineCode: string } | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = String(form.get("code") ?? "").trim();

    setPending(true);
    setError(null);

    try {
      const result =
        mode === "totp"
          ? await authClient.twoFactor.verifyTotp({ code })
          : await authClient.twoFactor.verifyBackupCode({ code });

      if (result.error) {
        setError(messageFor(result.error.code, result.error.status, copy));
        setPending(false);
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError({ text: copy.errors.notStarted, machineCode: "NETWORK_ERROR" });
      setPending(false);
    }
  }

  return (
    <div>
      <div className="flex gap-2 text-sm">
        <button
          type="button"
          onClick={() => setMode("totp")}
          aria-pressed={mode === "totp"}
          className={`rounded-(--radius-card) border px-3 py-2 ${
            mode === "totp"
              ? "border-accent text-accent font-semibold"
              : "border-border text-muted-foreground"
          }`}
        >
          {copy.useTotp}
        </button>
        <button
          type="button"
          onClick={() => setMode("backup")}
          aria-pressed={mode === "backup"}
          className={`rounded-(--radius-card) border px-3 py-2 ${
            mode === "backup"
              ? "border-accent text-accent font-semibold"
              : "border-border text-muted-foreground"
          }`}
        >
          {copy.useBackup}
        </button>
      </div>

      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
        <div>
          <label htmlFor="code" className="text-muted-foreground block text-sm">
            {mode === "totp" ? copy.codeLabel : copy.backupLabel}
          </label>
          <input
            id="code"
            name="code"
            required
            inputMode={mode === "totp" ? "numeric" : "text"}
            pattern={mode === "totp" ? "[0-9]{6}" : undefined}
            autoComplete="one-time-code"
            className="border-border bg-background ltr-island mt-1 w-full rounded-(--radius-card) border px-3 py-2 font-mono text-sm"
            dir="ltr"
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
          {pending ? copy.verifying : copy.submit}
        </button>
      </form>
    </div>
  );
}
