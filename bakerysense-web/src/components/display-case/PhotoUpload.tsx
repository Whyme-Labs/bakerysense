"use client";

import { useRef, useState } from "react";

interface PhotoUploadProps {
  onUpload: (imageBase64: string) => void;
  disabled?: boolean;
}

export function PhotoUpload({ onUpload, disabled }: PhotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setPreview(dataUrl);
      onUpload(dataUrl);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <label
        className={`flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center transition-colors hover:border-[var(--accent-info)] hover:bg-blue-50 ${
          disabled ? "pointer-events-none opacity-50" : ""
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={handleChange}
          disabled={disabled}
        />
        {preview ? (
          <img
            src={preview}
            alt={filename ?? "uploaded photo"}
            className="max-h-64 max-w-full rounded object-contain"
          />
        ) : (
          <>
            <svg
              className="mb-3 h-10 w-10 text-[var(--ink-subtle)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 16.5V18a2.25 2.25 0 002.25 2.25h13.5A2.25 2.25 0 0021 18v-1.5m-9-11.25V13.5m0-8.25-3 3m3-3 3 3"
              />
            </svg>
            <span className="text-sm text-[var(--ink-muted)]">
              Click to upload a display-case photo
            </span>
            <span className="mt-1 text-xs text-[var(--ink-subtle)]">
              JPEG, PNG, WEBP supported
            </span>
          </>
        )}
      </label>

      {filename && !disabled && (
        <p className="text-xs text-[var(--ink-subtle)]">
          {filename}
          {preview && (
            <button
              type="button"
              className="ml-2 text-[var(--accent-info)] hover:underline"
              onClick={() => {
                setPreview(null);
                setFilename(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
            >
              Change
            </button>
          )}
        </p>
      )}

      {disabled && (
        <p className="text-sm text-[var(--ink-muted)]">Uploading&hellip;</p>
      )}
    </div>
  );
}
