import "server-only";

/**
 * The failure vocabulary of the JS-free forms (spec §4: forms are HTML + Server
 * Actions, so a failure has to survive a redirect, not live in component state).
 *
 * A failing action redirects back to the page with `?notice=<code>`; the page maps
 * the code to localized copy from the dictionary and keeps the machine code visible
 * as an LTR island, so a screen message and a log line always match.
 *
 * The codes are stable keys on purpose. Library error codes (Better Auth's
 * `INVALID_EMAIL_OR_PASSWORD`, `VALIDATION_ERROR`, …) are *not* shown to users
 * directly: they are translated here, and the translation is pinned by
 * `tests/unit/actionError.test.ts` so an upgrade cannot silently turn a clear
 * message into a generic one.
 */
export const NOTICES = [
  "invalid_input",
  "wrong_password",
  "password_policy",
  "passwords_do_not_match",
  "invalid_code",
  "unauthorized",
  "forbidden",
  "mfa_required",
  "stale_session",
  "rate_limited",
  "email_taken",
  "account_not_found",
  "not_assignable",
  "cannot_modify_self",
  "last_privileged_account",
  "account_deactivated",
  "failed",
] as const;

export type NoticeCode = (typeof NOTICES)[number];

/** A failure a form may show. Never carries a secret, a code, or a stack. */
export class ActionError extends Error {
  readonly notice: NoticeCode;
  /** Library/diagnostic code, kept for the log and the LTR island on screen. */
  readonly machineCode: string | undefined;

  constructor(notice: NoticeCode, machineCode?: string) {
    super(notice);
    this.name = "ActionError";
    this.notice = notice;
    this.machineCode = machineCode;
  }
}

/**
 * Better Auth's APIError → a notice code.
 *
 * Measured 1.7.27 error shape (`scripts/.probe-admin-api.mts`):
 * `{ status, body: { code, message } }`. The status can be a number *or* the
 * HTTP reason phrase ("UNAUTHORIZED"), so both are read.
 */
export function noticeForAuthError(error: unknown): { notice: NoticeCode; machineCode: string } {
  const err = error as {
    status?: number | string;
    body?: { code?: string };
    code?: string;
    message?: string;
  };
  const machineCode = err?.body?.code ?? err?.code ?? String(err?.status ?? "UNKNOWN");

  switch (machineCode) {
    case "INVALID_EMAIL_OR_PASSWORD":
    case "INVALID_PASSWORD":
    case "USER_NOT_FOUND":
    case "INVALID_CREDENTIALS":
      return { notice: "wrong_password", machineCode };
    case "VALIDATION_ERROR":
      return { notice: "invalid_input", machineCode };
    case "UNAUTHORIZED":
      return { notice: "unauthorized", machineCode };
    case "FORBIDDEN":
    case "NOT_AUTHORIZED":
    case "BANISHED":
    case "USER_BANNED":
      return { notice: "forbidden", machineCode };
    case "TOO_MANY_REQUESTS":
    case "RATE_LIMIT_EXCEEDED":
      return { notice: "rate_limited", machineCode };
    case "USER_ALREADY_EXISTS":
    case "EMAIL_TAKEN":
      return { notice: "email_taken", machineCode };
    case "USER_NOT_FOUND_BY_ID":
    case "ACCOUNT_NOT_FOUND":
      return { notice: "account_not_found", machineCode };
    case "INVALID_CODE":
    case "INVALID_BACKUP_CODE":
    case "BACKUP_CODE_NOT_FOUND":
    case "TOTP_NOT_ENABLED":
    case "INVALID_TWO_FACTOR_COOKIE":
      return { notice: "invalid_code", machineCode };
    default:
      if (err?.status === 401) return { notice: "unauthorized", machineCode };
      if (err?.status === 403) return { notice: "forbidden", machineCode };
      if (err?.status === 429) return { notice: "rate_limited", machineCode };
      return { notice: "failed", machineCode };
  }
}

/** Query-string notice codes are user-controlled; only known keys are rendered. */
export function isNoticeCode(value: unknown): value is NoticeCode {
  return typeof value === "string" && (NOTICES as readonly string[]).includes(value);
}
