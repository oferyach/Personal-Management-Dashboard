"use client";

import { useId, useRef } from "react";

export function ConfirmSubmitButton({
  label,
  confirmLabel,
  cancelLabel,
  message,
  variant = "danger",
}: {
  label: string;
  confirmLabel: string;
  cancelLabel: string;
  message: string;
  variant?: "secondary" | "danger";
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const tone =
    variant === "danger"
      ? "border-danger text-danger bg-transparent"
      : "border-border bg-card text-foreground";

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className={`rounded-(--radius-card) border px-4 py-2 text-sm font-semibold ${tone}`}
      >
        {label}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="border-border bg-card text-foreground m-auto max-w-md rounded-(--radius-card) border p-0 shadow-xl backdrop:bg-black/60"
      >
        <div className="p-5">
          <h2 id={titleId} className="text-lg font-semibold">
            {label}
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">{message}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              autoFocus
              onClick={() => dialog.current?.close()}
              className="border-border rounded-(--radius-card) border px-4 py-2 text-sm"
            >
              {cancelLabel}
            </button>
            <button
              type="submit"
              className={`rounded-(--radius-card) border px-4 py-2 text-sm font-semibold ${tone}`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </dialog>
      <noscript>
        <button
          type="submit"
          className={`rounded-(--radius-card) border px-4 py-2 text-sm font-semibold ${tone}`}
        >
          {label}
        </button>
      </noscript>
    </>
  );
}
