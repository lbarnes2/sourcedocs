"use client";

import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import { autoDetectMapping, canonicalColumns, getRequiredMappingIssues } from "@/lib/csv/mapping";
import {
  defaultMenuBookletSettings,
  defaultPlaceCardSettings,
  defaultTablePlanSettings,
  defaultThemeSettings
} from "@/lib/defaults";
import type { ColumnMapping, DocumentType, GuestRecord, ProfileSettings, RawCsvRow } from "@/types";

const DOCUMENTS: Array<{ id: DocumentType; label: string }> = [
  { id: "tablePlanByTable", label: "Table Plan (By Table)" },
  { id: "tablePlanByPerson", label: "Table Plan (By Person)" },
  { id: "placeCards", label: "Place Cards" },
  { id: "menuBooklet", label: "Menu Card (A4 landscape, 2 sheets half-page layout)" },
  { id: "servicePlan", label: "Service Plan" }
];

const EDIT_LIMIT = 80;

function parseCsvClient(csvText: string): { headers: string[]; rows: RawCsvRow[] } {
  const parsed = Papa.parse<RawCsvRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim()
  });
  if (parsed.errors.length) {
    throw new Error(parsed.errors.map((error) => error.message).join("; "));
  }
  return { headers: parsed.meta.fields ?? [], rows: parsed.data };
}

function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read image."));
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const power = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** power;
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[power]}`;
}

function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.replace("#", "").trim();
  const full = cleaned.length === 3 ? cleaned.split("").map((c) => `${c}${c}`).join("") : cleaned;
  const numeric = Number.parseInt(full, 16);
  return {
    r: ((numeric >> 16) & 255) / 255,
    g: ((numeric >> 8) & 255) / 255,
    b: (numeric & 255) / 255
  };
}

function relativeLuminance(r: number, g: number, b: number): number {
  const normalize = (channel: number) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  const rr = normalize(r);
  const gg = normalize(g);
  const bb = normalize(b);
  return 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
}

async function estimateLogoLuminance(dataUrl: string): Promise<number | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const sampleW = Math.max(1, Math.min(120, image.naturalWidth));
        const sampleH = Math.max(1, Math.min(120, image.naturalHeight));
        canvas.width = sampleW;
        canvas.height = sampleH;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(image, 0, 0, sampleW, sampleH);
        const { data } = ctx.getImageData(0, 0, sampleW, sampleH);
        let sum = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3] / 255;
          if (alpha < 0.08) continue;
          sum += relativeLuminance(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
          count += 1;
        }
        resolve(count ? sum / count : null);
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = dataUrl;
  });
}

export default function HomePage() {
  const [csvText, setCsvText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [guests, setGuests] = useState<GuestRecord[]>([]);
  const [issues, setIssues] = useState<Array<{ severity: string; message: string }>>([]);
  const [error, setError] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingExport, setLoadingExport] = useState(false);
  const [exportProgressPct, setExportProgressPct] = useState(0);

  const [theme, setTheme] = useState({ ...defaultThemeSettings });
  const [tablePlan, setTablePlan] = useState({ ...defaultTablePlanSettings });
  const [placeCard, setPlaceCard] = useState({ ...defaultPlaceCardSettings });
  const [menuBooklet, setMenuBooklet] = useState({ ...defaultMenuBookletSettings });
  const [menuLongNames, setMenuLongNames] = useState<Record<string, string>>({});

  const [selectedDocuments, setSelectedDocuments] = useState<DocumentType[]>(DOCUMENTS.map((doc) => doc.id));
  const [bundleMode, setBundleMode] = useState<"single" | "zip">("zip");

  const [profiles, setProfiles] = useState<ProfileSettings[]>([]);
  const [profileName, setProfileName] = useState("New Profile");
  const [logoSizeWarnings, setLogoSizeWarnings] = useState<Partial<Record<"clientLogoDataUrl" | "venueLogoDataUrl", string>>>({});
  const [clientLogoLuminance, setClientLogoLuminance] = useState<number | null>(null);
  const [menuLogoLegibilityWarning, setMenuLogoLegibilityWarning] = useState("");

  const mappingIssues = useMemo(() => getRequiredMappingIssues(mapping), [mapping]);

  useEffect(() => {
    (async () => {
      const response = await fetch("/api/profiles");
      const payload = await response.json();
      if (payload.profiles) setProfiles(payload.profiles);
    })();
  }, []);

  useEffect(() => {
    if (clientLogoLuminance == null || !theme.clientLogoDataUrl) {
      setMenuLogoLegibilityWarning("");
      return;
    }
    const { r, g, b } = hexToRgb01(theme.primaryColor);
    const bgLuma = relativeLuminance(r, g, b);
    const lighter = Math.max(bgLuma, clientLogoLuminance);
    const darker = Math.min(bgLuma, clientLogoLuminance);
    const contrast = (lighter + 0.05) / (darker + 0.05);
    if (contrast < 2.2) {
      setMenuLogoLegibilityWarning(
        "Client logo appears close in brightness to the menu front background. Consider a lighter/darker variant for better legibility."
      );
    } else {
      setMenuLogoLegibilityWarning("");
    }
  }, [clientLogoLuminance, theme.clientLogoDataUrl, theme.primaryColor]);

  async function handleCsvFile(file: File) {
    setError("");
    const text = await file.text();
    setCsvText(text);
    const parsed = parseCsvClient(text);
    setHeaders(parsed.headers);
    setMapping(autoDetectMapping(parsed.headers));
  }

  async function runPreview() {
    if (!csvText) {
      setError("Upload a CSV first.");
      return;
    }
    if (mappingIssues.length) {
      setError(mappingIssues.join(" "));
      return;
    }
    setLoadingPreview(true);
    setError("");
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "preview", csvText, mapping })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to preview");
      const nextGuests: GuestRecord[] = payload.guests ?? [];
      setGuests(nextGuests);
      setIssues(payload.validation?.issues ?? []);
      const menuOptions = Array.from(
        new Set(
          nextGuests.flatMap((guest) =>
            [guest.starter, guest.main, guest.dessert].map((value) => value.trim()).filter(Boolean)
          )
        )
      );
      setMenuLongNames((previous) => {
        const next: Record<string, string> = {};
        menuOptions.forEach((option) => {
          next[option] = previous[option] ?? option;
        });
        return next;
      });
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Preview failed.");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleLogoUpload(file: File, field: "clientLogoDataUrl" | "venueLogoDataUrl") {
    const dataUrl = await toDataUrl(file);
    setTheme((previous) => ({ ...previous, [field]: dataUrl }));
    const slowThreshold = 700 * 1024;
    setLogoSizeWarnings((previous) => ({
      ...previous,
      [field]:
        file.size >= slowThreshold
          ? `${field === "clientLogoDataUrl" ? "Client" : "Venue"} logo is ${formatBytes(file.size)}. Large logos can slow PDF generation.`
          : undefined
    }));
    if (field === "clientLogoDataUrl") {
      const luma = await estimateLogoLuminance(dataUrl);
      setClientLogoLuminance(luma);
    }
  }

  async function saveCurrentProfile() {
    const id = profileName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const profile: ProfileSettings = {
      id,
      name: profileName,
      theme,
      tablePlan,
      placeCard,
      menuBooklet
    };
    const response = await fetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile)
    });
    if (!response.ok) {
      const payload = await response.json();
      setError(payload.error || "Could not save profile.");
      return;
    }
    setProfiles((previous) => {
      const withoutExisting = previous.filter((entry) => entry.id !== id);
      return [...withoutExisting, profile].sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  function applyProfile(profileId: string) {
    const found = profiles.find((profile) => profile.id === profileId);
    if (!found) return;
    setTheme(found.theme);
    setTablePlan(found.tablePlan);
    setPlaceCard(found.placeCard);
    setMenuBooklet(found.menuBooklet);
    setProfileName(found.name);
  }

  async function exportDocuments() {
    if (!guests.length) {
      setError("Run preview and validation before export.");
      return;
    }
    if (!selectedDocuments.length) {
      setError("Select at least one output document.");
      return;
    }
    if (bundleMode === "single" && selectedDocuments.length !== 1) {
      setError("Single-file mode requires exactly one selected document.");
      return;
    }

    setLoadingExport(true);
    setExportProgressPct(4);
    setError("");
    const includesPlaceCards = selectedDocuments.includes("placeCards");
    const hasClientLogo = Boolean(theme.clientLogoDataUrl);
    const progressCap = includesPlaceCards && hasClientLogo ? 92 : 96;
    const progressStepMs = includesPlaceCards && hasClientLogo ? 420 : 220;
    const progressTimer = window.setInterval(() => {
      setExportProgressPct((previous) => {
        if (previous >= progressCap) return previous;
        const delta = Math.max(1, Math.ceil((progressCap - previous) * 0.08));
        return Math.min(progressCap, previous + delta);
      });
    }, progressStepMs);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "generate",
          guests,
          request: {
            documents: selectedDocuments,
            bundleMode,
            theme,
            tablePlan,
            placeCard,
            menuBooklet,
            menuLongNames
          }
        })
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || "Export failed.");
      }

      const blob = await response.blob();
      window.clearInterval(progressTimer);
      setExportProgressPct(100);
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="(.+)"/);
      const filename = match?.[1] ?? (bundleMode === "single" ? "document.pdf" : "documents.zip");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      window.clearInterval(progressTimer);
      setError(exportError instanceof Error ? exportError.message : "Export failed.");
    } finally {
      window.clearInterval(progressTimer);
      setLoadingExport(false);
      window.setTimeout(() => setExportProgressPct(0), 800);
    }
  }

  return (
    <main>
      <h1>Event Document Generator</h1>
      <div className="panel">
        <h2>1) Upload CSV and map columns</h2>
        <div className="grid two">
          <label>
            CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void handleCsvFile(file);
                }
              }}
            />
          </label>
          <label>
            Event name
            <input
              value={theme.eventName}
              onChange={(event) => setTheme((previous) => ({ ...previous, eventName: event.target.value }))}
              placeholder="Smith Wedding 2026"
            />
          </label>
          <label>
            Event date
            <input
              value={theme.eventDate ?? ""}
              onChange={(event) => setTheme((previous) => ({ ...previous, eventDate: event.target.value }))}
              placeholder="Thursday 9th April 2026"
            />
          </label>
        </div>
        <div className="grid two">
          <label>
            Client logo
            <input
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleLogoUpload(file, "clientLogoDataUrl");
              }}
            />
          </label>
          <label>
            Venue logo
            <input
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleLogoUpload(file, "venueLogoDataUrl");
              }}
            />
          </label>
        </div>
        {(logoSizeWarnings.clientLogoDataUrl || logoSizeWarnings.venueLogoDataUrl || menuLogoLegibilityWarning) && (
          <ul>
            {logoSizeWarnings.clientLogoDataUrl && <li className="warning">{logoSizeWarnings.clientLogoDataUrl}</li>}
            {logoSizeWarnings.venueLogoDataUrl && <li className="warning">{logoSizeWarnings.venueLogoDataUrl}</li>}
            {menuLogoLegibilityWarning && <li className="warning">{menuLogoLegibilityWarning}</li>}
          </ul>
        )}
        {headers.length > 0 && (
          <div className="grid two">
            {canonicalColumns().map((column) => (
              <label key={column}>
                {column}
                <select
                  value={mapping[column] ?? ""}
                  onChange={(event) => {
                    const value = event.target.value || undefined;
                    setMapping((previous) => ({ ...previous, [column]: value }));
                  }}
                >
                  <option value="">-- not mapped --</option>
                  {headers.map((header) => (
                    <option key={`${column}-${header}`} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
        {mappingIssues.length > 0 && (
          <ul>
            {mappingIssues.map((issue) => (
              <li key={issue} className="warning">
                {issue}
              </li>
            ))}
          </ul>
        )}
        <button disabled={loadingPreview} onClick={runPreview}>
          {loadingPreview ? "Validating..." : "Preview and Validate"}
        </button>
      </div>

      <div className="panel">
        <h2>2) Validation report</h2>
        {!issues.length && <p className="pill">No validation issues reported yet.</p>}
        {issues.length > 0 && (
          <ul>
            {issues.map((issue, index) => (
              <li key={`${issue.message}-${index}`} className={issue.severity === "error" ? "error" : "warning"}>
                {issue.severity.toUpperCase()}: {issue.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel">
        <h2>3) Last-minute edits</h2>
        <p>Showing first {Math.min(EDIT_LIMIT, guests.length)} guests for quick in-app changes.</p>
        {guests.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Table</th>
                <th>Starter</th>
                <th>Main</th>
                <th>Dessert</th>
                <th>Dietary</th>
              </tr>
            </thead>
            <tbody>
              {guests.slice(0, EDIT_LIMIT).map((guest, guestIndex) => (
                <tr key={guest.id}>
                  <td>
                    <input
                      value={guest.name}
                      onChange={(event) => {
                        const value = event.target.value;
                        setGuests((previous) => {
                          const next = previous.slice();
                          next[guestIndex] = { ...next[guestIndex], name: value };
                          return next;
                        });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      value={guest.tableNumber}
                      onChange={(event) => {
                        const value = event.target.value;
                        setGuests((previous) => {
                          const next = previous.slice();
                          next[guestIndex] = { ...next[guestIndex], tableNumber: value };
                          return next;
                        });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      value={guest.starter}
                      onChange={(event) => {
                        const value = event.target.value;
                        setGuests((previous) => {
                          const next = previous.slice();
                          next[guestIndex] = { ...next[guestIndex], starter: value };
                          return next;
                        });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      value={guest.main}
                      onChange={(event) => {
                        const value = event.target.value;
                        setGuests((previous) => {
                          const next = previous.slice();
                          next[guestIndex] = { ...next[guestIndex], main: value };
                          return next;
                        });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      value={guest.dessert}
                      onChange={(event) => {
                        const value = event.target.value;
                        setGuests((previous) => {
                          const next = previous.slice();
                          next[guestIndex] = { ...next[guestIndex], dessert: value };
                          return next;
                        });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      value={guest.dietaryOriginal}
                      onChange={(event) => {
                        const value = event.target.value;
                        setGuests((previous) => {
                          const next = previous.slice();
                          next[guestIndex] = {
                            ...next[guestIndex],
                            dietaryOriginal: value,
                            dietaryNormalized: value
                              .split(/[;,/]/)
                              .map((entry) => entry.trim())
                              .filter(Boolean)
                          };
                          return next;
                        });
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>4) Profiles and print settings</h2>
        <div className="grid two">
          <label>
            Load profile
            <select onChange={(event) => applyProfile(event.target.value)} defaultValue="">
              <option value="">-- select profile --</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Save as profile name
            <input value={profileName} onChange={(event) => setProfileName(event.target.value)} />
          </label>
        </div>
        <button className="secondary" onClick={saveCurrentProfile}>
          Save profile
        </button>
        <h3 style={{ marginTop: 16 }}>Theme</h3>
        <div className="grid two">
          <label>
            Primary color
            <div className="color-field-row">
              <span className="color-swatch" style={{ backgroundColor: theme.primaryColor }} title="Preview" />
              <input
                type="color"
                className="color-input"
                value={theme.primaryColor}
                onChange={(event) => setTheme((previous) => ({ ...previous, primaryColor: event.target.value }))}
              />
              <span className="color-hex">{theme.primaryColor}</span>
            </div>
          </label>
          <label>
            Accent color
            <div className="color-field-row">
              <span className="color-swatch" style={{ backgroundColor: theme.accentColor }} title="Preview" />
              <input
                type="color"
                className="color-input"
                value={theme.accentColor}
                onChange={(event) => setTheme((previous) => ({ ...previous, accentColor: event.target.value }))}
              />
              <span className="color-hex">{theme.accentColor}</span>
            </div>
          </label>
        </div>

        <h3 style={{ marginTop: 16 }}>Table plan print controls</h3>
        <div className="grid two">
          <label>
            Paper size
            <select
              value={tablePlan.paperSize}
              onChange={(event) =>
                setTablePlan((previous) => ({
                  ...previous,
                  paperSize: event.target.value as "A4" | "A3"
                }))
              }
            >
              <option value="A4">A4</option>
              <option value="A3">A3</option>
            </select>
          </label>
          <label>
            Orientation
            <select
              value={tablePlan.orientation}
              onChange={(event) =>
                setTablePlan((previous) => ({
                  ...previous,
                  orientation: event.target.value as "portrait" | "landscape"
                }))
              }
            >
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
          <label>
            Density mode
            <select
              value={tablePlan.tablesPerSheetMode}
              onChange={(event) =>
                setTablePlan((previous) => ({
                  ...previous,
                  tablesPerSheetMode: event.target.value as "auto" | "manual"
                }))
              }
            >
              <option value="auto">Auto paginate</option>
              <option value="manual">Manual tables-per-sheet</option>
            </select>
          </label>
          <label>
            Tables per sheet
            <input
              type="number"
              min={1}
              value={tablePlan.tablesPerSheet}
              onChange={(event) =>
                setTablePlan((previous) => ({ ...previous, tablesPerSheet: Number(event.target.value) || 1 }))
              }
            />
          </label>
        </div>

        <h3 style={{ marginTop: 16 }}>Place-card stock calibration</h3>
        <p style={{ marginTop: 0, marginBottom: 8, fontSize: 13, opacity: 0.85 }}>
          Six guest panels per sheet: rows 2, 4, and 6 (1-based) carry name/table/menu/dietary; rows 1, 3, and 5 are
          tent backs with the client logo. Width and height below are reference only; text nudge still applies.
        </p>
        <div className="grid two">
          <label>
            Stock name
            <input
              value={placeCard.stockName}
              onChange={(event) => setPlaceCard((previous) => ({ ...previous, stockName: event.target.value }))}
            />
          </label>
          <label>
            Card width (mm)
            <input
              type="number"
              value={placeCard.cardWidthMm}
              onChange={(event) =>
                setPlaceCard((previous) => ({ ...previous, cardWidthMm: Number(event.target.value) || 0 }))
              }
            />
          </label>
          <label>
            Card height (mm)
            <input
              type="number"
              value={placeCard.cardHeightMm}
              onChange={(event) =>
                setPlaceCard((previous) => ({ ...previous, cardHeightMm: Number(event.target.value) || 0 }))
              }
            />
          </label>
          <label>
            Fold offset (mm, unused)
            <input
              type="number"
              value={placeCard.foldOffsetMm}
              onChange={(event) =>
                setPlaceCard((previous) => ({ ...previous, foldOffsetMm: Number(event.target.value) || 0 }))
              }
            />
          </label>
        </div>

        <h3 style={{ marginTop: 16 }}>Menu card long dish names</h3>
        <p>These descriptions are used only on menu cards. Place cards and service plans keep short names from CSV.</p>
        <div className="grid">
          {Object.keys(menuLongNames).length === 0 && <p className="pill">Run Preview first to populate menu options.</p>}
          {Object.entries(menuLongNames).map(([shortName, longName]) => (
            <label key={shortName}>
              {shortName}
              <textarea
                rows={2}
                value={longName}
                onChange={(event) =>
                  setMenuLongNames((previous) => ({
                    ...previous,
                    [shortName]: event.target.value
                  }))
                }
              />
            </label>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>5) Export bundle</h2>
        <div className="grid two">
          {DOCUMENTS.map((document) => {
            const checked = selectedDocuments.includes(document.id);
            return (
              <label key={document.id}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    setSelectedDocuments((previous) =>
                      checked ? previous.filter((item) => item !== document.id) : [...previous, document.id]
                    );
                  }}
                />{" "}
                {document.label}
              </label>
            );
          })}
          <label>
            Download mode
            <select value={bundleMode} onChange={(event) => setBundleMode(event.target.value as "single" | "zip")}>
              <option value="zip">ZIP (multiple files)</option>
              <option value="single">Single file (one selected output)</option>
            </select>
          </label>
        </div>
        <button disabled={loadingExport || loadingPreview} onClick={exportDocuments}>
          {loadingExport ? "Generating..." : "Generate and Download"}
        </button>
        {exportProgressPct > 0 && (
          <div style={{ marginTop: 10 }}>
            <progress value={exportProgressPct} max={100} style={{ width: "100%", height: 10 }} />
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "#3d4556" }}>
              Generating files... {exportProgressPct < 100 ? `${exportProgressPct}%` : "done"}
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="panel">
          <p className="error">{error}</p>
        </div>
      )}
    </main>
  );
}
