import Link from "next/link";

import type { Dictionary } from "@/i18n/dictionaries/types";

/**
 * The form primitives of the JS-free screens (spec §4: forms are HTML plus Server
 * Actions, no client JavaScript). Keeping them here means the settings and users
 * screens cannot accidentally introduce a client-side form that would break under
 * the production CSP or on a browser with JavaScript disabled.
 *
 * Nothing here holds state: a failure comes back as `?notice=<code>` in the URL and
 * is rendered from the dictionary, so a reload, a bookmark or a back button all show
 * the same screen.
 */

/** Renders `?notice=` / `?done=` from the dictionary; an unknown code renders the generic copy. */
export function Feedback({
  dict,
  notice,
  done,
}: {
  dict: Dictionary;
  notice?: string | string[];
  done?: string | string[];
}) {
  const noticeCode = typeof notice === "string" ? notice : undefined;
  const doneCode = typeof done === "string" ? done : undefined;
  const notices = dict.notices as Record<string, string>;
  const dones = dict.doneNotices as Record<string, string>;

  if (noticeCode) {
    return (
      <p
        className="border-warning bg-warning/10 rounded-(--radius-card) border px-4 py-3 text-sm"
        role="alert"
        data-notice={noticeCode}
      >
        {notices[noticeCode] ?? notices.failed}
        <span className="text-muted-foreground ltr-island ms-2 font-mono text-xs" dir="ltr">
          {noticeCode}
        </span>
      </p>
    );
  }

  if (doneCode) {
    return (
      <p
        className="border-success bg-success/10 rounded-(--radius-card) border px-4 py-3 text-sm"
        role="status"
        data-done={doneCode}
      >
        {dones[doneCode] ?? dict.common.success}
        <span className="text-muted-foreground ltr-island ms-2 font-mono text-xs" dir="ltr">
          {doneCode}
        </span>
      </p>
    );
  }

  return null;
}

export function SectionCard({
  title,
  body,
  children,
}: {
  title: string;
  body?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-border bg-card rounded-(--radius-card) border p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {body ? <p className="text-muted-foreground mt-1 text-sm">{body}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function TextField({
  name,
  label,
  type = "text",
  value,
  hint,
  autoComplete,
  required,
  machine,
  disabled,
}: {
  name: string;
  label: string;
  type?: "text" | "email" | "password" | "number" | "time";
  value?: string;
  hint?: string;
  autoComplete?: string;
  required?: boolean;
  /** Machine-shaped values (emails, host names, ISO values, secrets) render LTR. */
  machine?: boolean;
  disabled?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className="text-muted-foreground block text-sm">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        value={value}
        autoComplete={autoComplete}
        required={required}
        disabled={disabled}
        dir={machine ? "ltr" : undefined}
        className={`border-border bg-background mt-1 w-full rounded-(--radius-card) border px-3 py-2 text-sm disabled:opacity-60 ${
          machine ? "ltr-island font-mono" : ""
        }`}
      />
      {hint ? <p className="text-muted-foreground mt-1 text-xs">{hint}</p> : null}
    </div>
  );
}

export function SelectField({
  name,
  label,
  value,
  options,
  disabled,
  required,
  hint,
}: {
  name: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="text-muted-foreground block text-sm">
        {label}
      </label>
      <select
        id={name}
        name={name}
        defaultValue={value}
        disabled={disabled}
        required={required}
        className="border-border bg-background mt-1 w-full rounded-(--radius-card) border px-3 py-2 text-sm disabled:opacity-60"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? <p className="text-muted-foreground mt-1 text-xs">{hint}</p> : null}
    </div>
  );
}

export function CheckboxField({
  name,
  label,
  value,
  checked,
}: {
  name: string;
  label: string;
  value: string;
  checked: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} value={value} defaultChecked={checked} />
      <span>{label}</span>
    </label>
  );
}

export function SubmitButton({
  label,
  variant = "primary",
  disabled,
}: {
  label: string;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
}) {
  const tone =
    variant === "danger"
      ? "border-danger text-danger bg-transparent"
      : variant === "secondary"
        ? "border-border bg-card text-foreground"
        : "bg-accent text-accent-foreground";

  return (
    <button
      type="submit"
      disabled={disabled}
      className={`rounded-(--radius-card) px-4 py-2 text-sm font-semibold disabled:opacity-60 ${
        variant === "primary" ? tone : `border ${tone}`
      }`}
    >
      {label}
    </button>
  );
}

/** A small machine-value chip (role keys, enum codes, counts). */
export function MachineValue({ value, label }: { value: string | number; label?: string }) {
  return (
    <span className="text-muted-foreground inline-flex items-baseline gap-1">
      {label ? <span>{label}</span> : null}
      <span className="text-foreground ltr-island font-mono" dir="ltr">
        {value}
      </span>
    </span>
  );
}

export function TabLinks({
  tabs,
  pathname,
  label,
}: {
  tabs: Array<{ href: string; label: string }>;
  pathname: string;
  label: string;
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2 text-sm">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-(--radius-card) border px-3 py-2 ${
              active
                ? "border-accent text-accent font-semibold"
                : "border-border text-muted-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
