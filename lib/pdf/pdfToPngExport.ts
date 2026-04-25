import JSZip from "jszip";

export type PdfPngPage = {
  filename: string;
  blob: Blob;
};

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function pdfBlobToPngPages(pdfBlob: Blob, baseName: string): Promise<PdfPngPage[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();
  const bytes = new Uint8Array(await pdfBlob.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const pages: PdfPngPage[] = [];
  const pageDigits = String(pdf.numPages).length;

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Canvas rendering is unavailable in this browser.");
      }

      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: context, viewport }).promise;
      const blob = await canvasToPngBlob(canvas);
      const suffix = pdf.numPages === 1 ? "" : `-page-${String(pageNumber).padStart(pageDigits, "0")}`;
      pages.push({ filename: `${baseName}${suffix}.png`, blob });
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }

  return pages;
}

export async function downloadPdfBlobAsPngs(pdfBlob: Blob, baseName: string): Promise<void> {
  const pages = await pdfBlobToPngPages(pdfBlob, baseName);
  if (pages.length === 1) {
    downloadBlob(pages[0].blob, pages[0].filename);
    return;
  }
  const zip = await zipPngPages(pages);
  downloadBlob(zip, `${baseName}-png.zip`);
}

export async function downloadPdfBlobsAsPngZip(
  pdfs: Array<{ blob: Blob; baseName: string }>,
  zipName: string
): Promise<void> {
  const pageGroups = await Promise.all(pdfs.map((pdf) => pdfBlobToPngPages(pdf.blob, pdf.baseName)));
  const zip = await zipPngPages(pageGroups.flat());
  downloadBlob(zip, zipName.endsWith(".zip") ? zipName : `${zipName}.zip`);
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Could not create PNG image."));
      }
    }, "image/png");
  });
}

async function zipPngPages(pages: PdfPngPage[]): Promise<Blob> {
  const zip = new JSZip();
  for (const page of pages) {
    zip.file(page.filename, page.blob);
  }
  return zip.generateAsync({ type: "blob" });
}
