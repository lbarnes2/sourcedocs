"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, EyeOff } from "lucide-react";
import { Callout } from "@/app/components/ui";
import { readResponseError } from "@/lib/http/readError";
import { renderPdfPageToPng } from "@/lib/pdf/pdfToPngExport";
import type { DocumentType } from "@/types";

const DEBOUNCE_MS = 700;

function readWarnings(response: Response): string[] {
  const raw = response.headers.get("X-Generation-Warnings");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Live preview of one banqueting document. Re-renders shortly after the last edit and shows the
 * same layout warnings an export would, so overflow is caught before anything is printed.
 */
export function PreviewPanel({
  documents,
  buildBody
}: {
  documents: Array<{ id: DocumentType; label: string }>;
  /** The /api/generate request for one document, as JSON. Changes whenever anything that prints changes. */
  buildBody: (documentType: DocumentType) => string;
}) {
  const [on, setOn] = useState(true);
  const [documentType, setDocumentType] = useState<DocumentType>(documents[0]?.id ?? "tablePlanByTable");
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const body = on ? buildBody(documentType) : "";
  /** The PDF for the current settings, kept so changing page doesn't call the server again. */
  const pdfRef = useRef<{ body: string; blob: Blob } | null>(null);
  const imageUrlRef = useRef<string | null>(null);

  const showPage = async (blob: Blob, wanted: number, isCurrent: () => boolean) => {
    const rendered = await renderPdfPageToPng(blob, wanted);
    if (!isCurrent()) return;
    const url = URL.createObjectURL(rendered.blob);
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    imageUrlRef.current = url;
    setImageUrl(url);
    setPageCount(rendered.pageCount);
    setPageNumber(rendered.pageNumber);
  };

  // Fetch a fresh PDF shortly after the settings stop changing.
  useEffect(() => {
    if (!body) return;
    const controller = new AbortController();
    const isCurrent = () => !controller.signal.aborted;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: controller.signal
        });
        if (!response.ok) throw new Error(await readResponseError(response, "Preview failed."));
        const blob = await response.blob();
        if (!isCurrent()) return;
        pdfRef.current = { body, blob };
        setWarnings(readWarnings(response));
        setError("");
        await showPage(blob, pageNumber, isCurrent);
      } catch (e) {
        if (isCurrent()) setError(e instanceof Error ? e.message : "Preview failed.");
      } finally {
        if (isCurrent()) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
    // pageNumber is read, not watched: turning pages is handled by goToPage without refetching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

  useEffect(
    () => () => {
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    },
    []
  );

  const goToPage = (next: number) => {
    const pdf = pdfRef.current;
    if (!pdf || next < 1 || next > pageCount) return;
    setPageNumber(next);
    void showPage(pdf.blob, next, () => pdfRef.current === pdf).catch(() => undefined);
  };

  return (
    <section className="card preview-panel" aria-label="Preview">
      <div className="preview-head">
        <h2 className="card-title">
          <span className="card-title-text">Preview</span>
        </h2>
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => setOn((value) => !value)}
          aria-pressed={on}
          title={on ? "Pause the live preview" : "Resume the live preview"}
        >
          {on ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />} {on ? "Pause" : "Resume"}
        </button>
      </div>
      <div className="preview-controls">
        <select
          className="select-sm"
          value={documentType}
          aria-label="Document to preview"
          onChange={(event) => {
            setDocumentType(event.target.value as DocumentType);
            setPageNumber(1);
          }}
        >
          {documents.map((document) => (
            <option key={document.id} value={document.id}>
              {document.label}
            </option>
          ))}
        </select>
        <div className="preview-pager">
          <button
            type="button"
            className="icon-btn icon-btn--sm"
            aria-label="Previous page"
            disabled={pageNumber <= 1}
            onClick={() => goToPage(pageNumber - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-muted text-sm" aria-live="polite">
            {pageCount ? `Page ${pageNumber} of ${pageCount}` : "—"}
          </span>
          <button
            type="button"
            className="icon-btn icon-btn--sm"
            aria-label="Next page"
            disabled={pageNumber >= pageCount}
            onClick={() => goToPage(pageNumber + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className={`preview-stage${loading ? " preview-stage--loading" : ""}`}>
        {!on ? (
          <p className="text-muted text-sm">Preview paused.</p>
        ) : imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={`Preview of ${documents.find((d) => d.id === documentType)?.label ?? "document"}, page ${pageNumber}`} />
        ) : (
          <p className="text-muted text-sm">{error ? "No preview." : "Rendering…"}</p>
        )}
      </div>
      {loading && imageUrl ? <p className="text-muted text-sm preview-status">Updating…</p> : null}
      {error ? <Callout tone="error">{error}</Callout> : null}
      {on && warnings.length ? (
        <Callout tone="warning">
          <strong>Check before printing:</strong>
          <ul>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Callout>
      ) : null}
    </section>
  );
}
