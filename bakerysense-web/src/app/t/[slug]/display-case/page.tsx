"use client";

import { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { apiJson } from "@/lib/api-client";
import { PhotoUpload } from "@/components/display-case/PhotoUpload";
import { CountsTable } from "@/components/display-case/CountsTable";
import { MarkdownList } from "@/components/display-case/MarkdownList";

interface MarkdownItem {
  sku: string;
  remaining?: number;
  discount_pct: number;
  reason?: string;
}

interface SuggestResult {
  branch_id?: string;
  as_of?: string;
  markdowns?: MarkdownItem[];
  error?: string;
}

interface PhotoResult {
  counts: Record<string, number>;
  suggestions: SuggestResult;
}

export default function DisplayCasePage() {
  const params = useParams<{ slug: string }>();
  const search = useSearchParams();
  const slug = params?.slug ?? "";
  const branch = search.get("branch") ?? "";
  const [result, setResult] = useState<PhotoResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(imageBase64: string) {
    if (!branch) {
      setError("Select a branch first.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const res = await apiJson<PhotoResult>("/api/photo", {
        method: "POST",
        body: JSON.stringify({ branchId: branch, imageBase64 }),
      });
      setResult(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function updateCounts(counts: Record<string, number>) {
    if (result) setResult({ ...result, counts });
  }

  const suggestionList = result?.suggestions?.markdowns ?? [];
  const chatPrefill = result
    ? encodeURIComponent(
        `[inventory: ${JSON.stringify(result.counts)}] What should I mark down and why?`,
      )
    : "";

  return (
    <>
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Display case</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Photograph the shelf — Gemma counts remaining units and suggests markdowns.
          </p>
        </div>
        {result && (
          <a
            href={`/t/${slug}/chat?branch=${branch}&prefill=${chatPrefill}`}
            className="text-sm text-[var(--accent-info)] hover:underline"
          >
            Chat about this &rarr;
          </a>
        )}
      </div>

      <section className="mb-8 rounded-lg border border-[var(--border)] bg-white p-6 shadow-[var(--shadow-sm)]">
        <PhotoUpload onUpload={upload} disabled={uploading} />
        {error && <p className="mt-3 text-sm text-[var(--accent-warn)]">{error}</p>}
      </section>

      {result && (
        <>
          <section className="mb-8 rounded-lg border border-[var(--border)] bg-white p-6 shadow-[var(--shadow-sm)]">
            <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-[var(--ink-subtle)]">
              Counts
            </h2>
            <CountsTable counts={result.counts} onChange={updateCounts} />
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-white p-6 shadow-[var(--shadow-sm)]">
            <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-[var(--ink-subtle)]">
              Markdown suggestions
            </h2>
            <MarkdownList suggestions={suggestionList} />
          </section>
        </>
      )}
    </>
  );
}
