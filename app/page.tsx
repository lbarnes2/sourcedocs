"use client";

import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import { autoDetectMapping, canonicalColumns, getRequiredMappingIssues } from "@/lib/csv/mapping";
import { normalizeDietary } from "@/lib/csv/validation";
import {
  defaultMenuBookletSettings,
  defaultPlaceCardSettings,
  defaultTablePlanSettings,
  defaultThemeSettings
} from "@/lib/defaults";
import { rewriteDishWithShortOverride } from "@/lib/dish/applyOverrides";
import type {
  ColumnMapping,
  DishMenuDuplicateGroup,
  DishNameOverride,
  DocumentType,
  EventProjectFile,
  GuestRecord,
  ProfileSettings,
  ProjectListItem,
  RawCsvRow
} from "@/types";

const DOCUMENTS: Array<{ id: DocumentType; label: string }> = [
  { id: "tablePlanByTable", label: "Table Plan (By Table)" },
  { id: "tablePlanByPerson", label: "Table Plan (By Person)" },
  { id: "placeCards", label: "Place Cards" },
  { id: "menuBooklet", label: "Menu Card (A4 landscape, 2 sheets half-page layout)" },
  { id: "servicePlan", label: "Service Plan" }
];

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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read image."));
    reader.readAsDataURL(blob);
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
  const [tablePlanByPerson, setTablePlanByPerson] = useState({ ...defaultTablePlanSettings });
  const [placeCard, setPlaceCard] = useState({ ...defaultPlaceCardSettings });
  const [menuBooklet, setMenuBooklet] = useState({ ...defaultMenuBookletSettings });
  const [dishNameOverrides, setDishNameOverrides] = useState<Record<string, DishNameOverride>>({});
  const [dishMenuDuplicateGroups, setDishMenuDuplicateGroups] = useState<
    Array<DishMenuDuplicateGroup & { id: string }>
  >([]);
  const [menuMergePick, setMenuMergePick] = useState<string[]>([]);
  const [normalizeGuestNamesToTitleCase, setNormalizeGuestNamesToTitleCase] = useState(false);

  const [selectedDocuments, setSelectedDocuments] = useState<DocumentType[]>(DOCUMENTS.map((doc) => doc.id));
  const [bundleMode, setBundleMode] = useState<"single" | "zip">("zip");

  const [profiles, setProfiles] = useState<ProfileSettings[]>([]);
  const [profileName, setProfileName] = useState("New Profile");
  const [logoSizeWarnings, setLogoSizeWarnings] = useState<Partial<Record<"clientLogoDataUrl" | "venueLogoDataUrl", string>>>({});
  const [clientLogoLuminance, setClientLogoLuminance] = useState<number | null>(null);
  const [menuLogoLegibilityWarning, setMenuLogoLegibilityWarning] = useState("");

  const [venueLogoLibrary, setVenueLogoLibrary] = useState<{
    loaded: boolean;
    configured: boolean;
    items: Array<{ key: string; label: string; assetUrl: string }>;
  }>({ loaded: false, configured: false, items: [] });
  const [selectedVenueLogoKey, setSelectedVenueLogoKey] = useState<string | null>(null);
  const [venueLibraryBusy, setVenueLibraryBusy] = useState(false);

  const [projectList, setProjectList] = useState<ProjectListItem[]>([]);
  const [projectStorage, setProjectStorage] = useState<"r2" | "local" | "">("");
  const [projectLibraryName, setProjectLibraryName] = useState("");
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [projectLoadSelection, setProjectLoadSelection] = useState("");
  const [projectBusy, setProjectBusy] = useState(false);

  const mappingIssues = useMemo(() => getRequiredMappingIssues(mapping), [mapping]);

  const uniqueEffectiveDishes = useMemo(() => {
    const set = new Set<string>();
    guests.forEach((guest) => {
      (["starter", "main", "dessert"] as const).forEach((field) => {
        const rewritten = rewriteDishWithShortOverride(guest[field], dishNameOverrides).trim();
        if (rewritten) set.add(rewritten);
      });
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [guests, dishNameOverrides]);

  useEffect(() => {
    const valid = new Set(uniqueEffectiveDishes);
    setDishMenuDuplicateGroups((previous) => {
      const next = previous
        .map((group) => ({
          ...group,
          match: group.match.filter((member) => valid.has(member.trim()))
        }))
        .filter((group) => group.match.length >= 2);
      if (JSON.stringify(previous) === JSON.stringify(next)) return previous;
      return next;
    });
  }, [uniqueEffectiveDishes]);

  useEffect(() => {
    (async () => {
      const response = await fetch("/api/profiles");
      const payload = await response.json();
      if (payload.profiles) setProfiles(payload.profiles);
    })();
  }, []);

  async function refreshProjectList() {
    try {
      const response = await fetch("/api/projects");
      const payload = await response.json();
      if (Array.isArray(payload.projects)) {
        setProjectList(payload.projects);
      }
      if (payload.storage === "r2" || payload.storage === "local") {
        setProjectStorage(payload.storage);
      }
    } catch {
      setProjectList([]);
    }
  }

  useEffect(() => {
    void refreshProjectList();
  }, []);

  async function applyLoadedProject(file: EventProjectFile) {
    setCsvText(file.csvText);
    setHeaders(file.headers);
    setMapping(file.mapping);
    setGuests(file.guests);
    setIssues(file.issues);
    setTheme({ ...defaultThemeSettings, ...file.theme });
    setTablePlan({ ...defaultTablePlanSettings, ...file.tablePlan });
    setTablePlanByPerson({
      ...defaultTablePlanSettings,
      ...file.tablePlanByPerson
    });
    setPlaceCard({ ...defaultPlaceCardSettings, ...file.placeCard });
    setMenuBooklet({ ...defaultMenuBookletSettings, ...file.menuBooklet });
    setDishNameOverrides(file.dishNameOverrides ?? {});
    setDishMenuDuplicateGroups(file.dishMenuDuplicateGroups ?? []);
    setMenuMergePick([]);
    setNormalizeGuestNamesToTitleCase(file.normalizeGuestNamesToTitleCase ?? false);
    setSelectedDocuments(
      file.selectedDocuments?.length ? file.selectedDocuments : DOCUMENTS.map((doc) => doc.id)
    );
    setBundleMode(file.bundleMode === "single" ? "single" : "zip");
    setProfileName(file.profileName ?? "New Profile");
    setSelectedVenueLogoKey(file.selectedVenueLogoKey ?? null);
    setCurrentProjectId(file.id);
    setProjectLibraryName(file.name);
    setProjectLoadSelection("");
    setError("");
    if (file.theme.clientLogoDataUrl) {
      const luma = await estimateLogoLuminance(file.theme.clientLogoDataUrl);
      setClientLogoLuminance(luma);
    } else {
      setClientLogoLuminance(null);
    }
    void refreshVenueLogoLibrary();
  }

  async function saveProjectToLibrary() {
    const name =
      projectLibraryName.trim() || theme.eventName.trim() || "Untitled project";
    setProjectBusy(true);
    setError("");
    try {
      const payload = {
        id: currentProjectId,
        name,
        csvText,
        headers,
        mapping,
        guests,
        issues,
        theme,
        tablePlan,
        tablePlanByPerson,
        placeCard,
        menuBooklet,
        dishNameOverrides,
        dishMenuDuplicateGroups,
        normalizeGuestNamesToTitleCase,
        selectedDocuments,
        bundleMode,
        profileName,
        selectedVenueLogoKey
      };
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Save failed.");
      setCurrentProjectId(data.id);
      setProjectLibraryName(name);
      await refreshProjectList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setProjectBusy(false);
    }
  }

  async function loadSelectedProject() {
    const id = projectLoadSelection.trim();
    if (!id) {
      setError("Choose a saved project to load.");
      return;
    }
    setProjectBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Load failed.");
      await applyLoadedProject(data.project as EventProjectFile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed.");
    } finally {
      setProjectBusy(false);
    }
  }

  async function deleteSelectedProject() {
    const id = projectLoadSelection.trim();
    if (!id) return;
    if (!window.confirm("Delete this saved project from storage? This cannot be undone.")) return;
    setProjectBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Delete failed.");
      if (currentProjectId === id) {
        setCurrentProjectId(null);
      }
      setProjectLoadSelection("");
      await refreshProjectList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setProjectBusy(false);
    }
  }

  async function refreshVenueLogoLibrary() {
    setVenueLibraryBusy(true);
    try {
      const response = await fetch("/api/logos/venue");
      const payload = await response.json();
      setVenueLogoLibrary({
        loaded: true,
        configured: Boolean(payload.configured),
        items: Array.isArray(payload.items) ? payload.items : []
      });
    } catch {
      setVenueLogoLibrary({ loaded: true, configured: false, items: [] });
    } finally {
      setVenueLibraryBusy(false);
    }
  }

  useEffect(() => {
    void refreshVenueLogoLibrary();
  }, []);

  async function applyVenueLogoFromLibrary(item: { assetUrl: string; key: string }) {
    setError("");
    try {
      const response = await fetch(item.assetUrl);
      if (!response.ok) throw new Error("Could not load that logo from storage.");
      const blob = await response.blob();
      const dataUrl = await blobToDataUrl(blob);
      setTheme((previous) => ({ ...previous, venueLogoDataUrl: dataUrl }));
      setSelectedVenueLogoKey(item.key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply venue logo.");
    }
  }

  async function uploadVenueLogoToLibrary(file: File) {
    setVenueLibraryBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/logos/venue", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Upload failed.");
      await refreshVenueLogoLibrary();
      setSelectedVenueLogoKey(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setVenueLibraryBusy(false);
    }
  }

  async function deleteVenueLogoFromLibrary(key: string) {
    if (!window.confirm("Remove this venue logo from the library?")) return;
    setVenueLibraryBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/logos/venue?key=${encodeURIComponent(key)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Delete failed.");
      await refreshVenueLogoLibrary();
      if (selectedVenueLogoKey === key) {
        setSelectedVenueLogoKey(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setVenueLibraryBusy(false);
    }
  }

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
      setDishNameOverrides((previous) => {
        const next: Record<string, DishNameOverride> = {};
        menuOptions.forEach((option) => {
          const prior = previous[option];
          next[option] = prior ?? { shortName: option, longName: option };
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
      tablePlanByPerson,
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
    setTablePlanByPerson(found.tablePlanByPerson ?? found.tablePlan);
    setPlaceCard(found.placeCard);
    setMenuBooklet({ ...defaultMenuBookletSettings, ...found.menuBooklet });
    setProfileName(found.name);
  }

  function addMenuDuplicateGroup() {
    if (menuMergePick.length < 2) {
      setError("Select at least two dishes (⌘ or Ctrl-click) to merge onto one menu line.");
      return;
    }
    const match = [...menuMergePick];
    const used = new Set<string>();
    dishMenuDuplicateGroups.forEach((group) => {
      group.match.forEach((member) => used.add(member.trim()));
    });
    const clash = match.find((member) => used.has(member.trim()));
    if (clash) {
      setError(
        `“${clash}” is already in a merge group. Remove that group first, or leave it out of this selection.`
      );
      return;
    }
    const canonical = [...match].sort((a, b) => a.localeCompare(b))[0];
    setDishMenuDuplicateGroups((previous) => [
      ...previous,
      { id: crypto.randomUUID(), canonical, match }
    ]);
    setMenuMergePick([]);
    setError("");
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
            tablePlanByPerson,
            placeCard,
            menuBooklet,
            dishNameOverrides,
            dishMenuDuplicateGroups: dishMenuDuplicateGroups.map(({ canonical, match }) => ({
              canonical,
              match
            })),
            normalizeGuestNamesToTitleCase
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
        <h2 className="step-heading">
          <span className="step-heading-badge">·</span>
          <span>Saved projects</span>
        </h2>
        <p style={{ marginTop: 0, marginBottom: 12, fontSize: 14, opacity: 0.88 }}>
          Save or load the full workspace (CSV, guest edits, theme, logos, print settings, dish overrides).
          Nothing is saved until you click <strong>Save project</strong>.
        </p>
        {projectStorage === "r2" && (
          <p className="pill" style={{ marginBottom: 12 }}>
            Projects are stored in your R2 bucket under <code>projects/</code>.
          </p>
        )}
        {projectStorage === "local" && (
          <p className="pill" style={{ marginBottom: 12 }}>
            R2 is not configured — projects are stored on this server in <code>data/projects/</code> (see{" "}
            <code>.env.example</code>).
          </p>
        )}
        <div className="grid two">
          <label>
            Project name
            <input
              value={projectLibraryName}
              onChange={(event) => setProjectLibraryName(event.target.value)}
              placeholder="e.g. Smith Wedding — April 2026"
            />
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, justifyContent: "flex-end" }}>
            {currentProjectId && (
              <p style={{ margin: 0, fontSize: 12, opacity: 0.82 }}>
                Updating saved id <code>{currentProjectId.slice(0, 8)}…</code> — save again to overwrite.
              </p>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <button type="button" disabled={projectBusy} onClick={() => void saveProjectToLibrary()}>
                {projectBusy ? "Working…" : "Save project"}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={projectBusy}
                onClick={() => {
                  setCurrentProjectId(null);
                  setError("");
                }}
              >
                New save target
              </button>
            </div>
          </div>
        </div>
        <div className="grid two" style={{ marginTop: 14 }}>
          <label>
            Open saved project
            <select
              value={projectLoadSelection}
              onChange={(event) => setProjectLoadSelection(event.target.value)}
            >
              <option value="">— choose —</option>
              {projectList.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.eventName ? ` (${item.eventName})` : ""} —{" "}
                  {new Date(item.savedAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short"
                  })}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
            <button type="button" disabled={projectBusy || !projectLoadSelection} onClick={() => void loadSelectedProject()}>
              Load project
            </button>
            <button
              type="button"
              className="secondary"
              disabled={projectBusy || !projectLoadSelection}
              onClick={() => void deleteSelectedProject()}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
      <div className="panel">
        <h2 className="step-heading">
          <span className="step-heading-badge">1</span>
          <span>Upload CSV and map columns</span>
        </h2>
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
                if (file) {
                  setSelectedVenueLogoKey(null);
                  void handleLogoUpload(file, "clientLogoDataUrl");
                }
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
                if (file) {
                  setSelectedVenueLogoKey(null);
                  void handleLogoUpload(file, "venueLogoDataUrl");
                }
              }}
            />
          </label>
        </div>
        {venueLogoLibrary.loaded && venueLogoLibrary.configured && (
          <div style={{ marginTop: 14 }}>
            <h3 style={{ fontSize: 15, margin: "0 0 6px" }}>Venue logo library (R2)</h3>
            <p style={{ margin: "0 0 10px", fontSize: 13, opacity: 0.86 }}>
              Upload once, then click a thumbnail to use it for this event. Logos are stored in your bucket under{" "}
              <code>logos/venue/</code>.
            </p>
            <label>
              Add logo to library
              <input
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                disabled={venueLibraryBusy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void uploadVenueLogoToLibrary(file);
                }}
              />
            </label>
            {venueLibraryBusy && <p style={{ fontSize: 12, margin: "8px 0 0" }}>Working…</p>}
            {venueLogoLibrary.items.length === 0 && !venueLibraryBusy ? (
              <p className="pill" style={{ marginTop: 10 }}>
                No saved venue logos yet — add one with the field above.
              </p>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 10,
                  marginTop: 10,
                  alignItems: "flex-start"
                }}
              >
                {venueLogoLibrary.items.map((item) => (
                  (() => {
                    const isSelected = selectedVenueLogoKey === item.key;
                    return (
                  <div
                    key={item.key}
                    className="panel"
                    style={{
                      marginBottom: 0,
                      padding: 8,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 6,
                      minWidth: 120,
                      borderColor: isSelected ? "#012f43" : undefined,
                      boxShadow: isSelected ? "0 0 0 1px rgba(1,47,67,0.3)" : undefined,
                      background: isSelected ? "#f0f5f8" : undefined
                    }}
                  >
                    <img
                      src={item.assetUrl}
                      alt=""
                      style={{
                        width: 80,
                        height: 80,
                        objectFit: "contain",
                        background: "#f4f6f8",
                        borderRadius: 4
                      }}
                    />
                    {isSelected && (
                      <span style={{ fontSize: 11, color: "#012f43", fontWeight: 600 }}>Selected</span>
                    )}
                    <span style={{ fontSize: 11, opacity: 0.75, maxWidth: 120, textAlign: "center", wordBreak: "break-all" }}>
                      {item.label}
                    </span>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                      <button
                        type="button"
                        disabled={venueLibraryBusy || isSelected}
                        onClick={() => void applyVenueLogoFromLibrary(item)}
                      >
                        {isSelected ? "In use" : "Use"}
                      </button>
                      <button type="button" disabled={venueLibraryBusy} onClick={() => void deleteVenueLogoFromLibrary(item.key)}>
                        Remove
                      </button>
                    </div>
                  </div>
                    );
                  })()
                ))}
              </div>
            )}
          </div>
        )}
        {venueLogoLibrary.loaded && !venueLogoLibrary.configured && (
          <p className="pill" style={{ marginTop: 12 }}>
            R2 env vars not set — profiles stay in <code>data/profiles</code>; venue logo library is disabled. See{" "}
            <code>.env.example</code>.
          </p>
        )}
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
        <h2 className="step-heading">
          <span className="step-heading-badge">2</span>
          <span>Validation report</span>
        </h2>
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
        <h2 className="step-heading">
          <span className="step-heading-badge">3</span>
          <span>Last-minute edits</span>
        </h2>
        {guests.length === 0 && <p className="pill">Run Preview to populate the editable guest list.</p>}
        {guests.length > 0 && (
          <details open>
            <summary style={{ cursor: "pointer", marginBottom: 10 }}>
              Editing {guests.length} guest{guests.length === 1 ? "" : "s"} (click to collapse)
            </summary>
            <div style={{ maxHeight: 420, overflow: "auto", borderRadius: 10, border: "1px solid #d9deea" }}>
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
              {guests.map((guest, guestIndex) => (
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
                            dietaryNormalized: normalizeDietary(value)
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
            </div>
          </details>
        )}
      </div>

      <div className="panel">
        <h2 className="step-heading">
          <span className="step-heading-badge">4</span>
          <span>Profiles and print settings</span>
        </h2>
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
        <div className="subpanel">
          <h3 style={{ marginTop: 0 }}>Theme</h3>
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
        </div>

        <div className="subpanel">
          <h3 style={{ marginTop: 0 }}>Table plan (by table) print controls</h3>
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
        </div>

        <div className="subpanel">
          <h3 style={{ marginTop: 0 }}>Table plan (by person) print controls</h3>
          <p style={{ marginTop: 0, marginBottom: 8, fontSize: 13, opacity: 0.85 }}>
            Often A4 for legibility; you can also switch to landscape to enable a two-column layout.
          </p>
          <div className="grid two">
            <label>
              Paper size
              <select
                value={tablePlanByPerson.paperSize}
                onChange={(event) =>
                  setTablePlanByPerson((previous) => ({
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
                value={tablePlanByPerson.orientation}
                onChange={(event) =>
                  setTablePlanByPerson((previous) => ({
                    ...previous,
                    orientation: event.target.value as "portrait" | "landscape"
                  }))
                }
              >
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape (two-column)</option>
              </select>
            </label>
            <label>
              Density mode
              <select
                value={tablePlanByPerson.tablesPerSheetMode}
                onChange={(event) =>
                  setTablePlanByPerson((previous) => ({
                    ...previous,
                    tablesPerSheetMode: event.target.value as "auto" | "manual"
                  }))
                }
              >
                <option value="auto">Auto paginate</option>
                <option value="manual">Manual rows-per-page</option>
              </select>
            </label>
            <label>
              Rows per page (manual)
              <input
                type="number"
                min={1}
                value={tablePlanByPerson.tablesPerSheet}
                onChange={(event) =>
                  setTablePlanByPerson((previous) => ({
                    ...previous,
                    tablesPerSheet: Number(event.target.value) || 1
                  }))
                }
              />
            </label>
          </div>
        </div>

        <div className="subpanel">
          <h3 style={{ marginTop: 0 }}>Place-card stock calibration</h3>
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
        </div>

        <div className="subpanel">
          <h3 style={{ marginTop: 0 }}>Menu card extras</h3>
          <p style={{ marginTop: 0, marginBottom: 8, fontSize: 13, opacity: 0.85 }}>
            Optional text above the first course and/or below the last course (for example bread and butter, tea and
            coffee).
          </p>
          <div className="grid two">
            <label>
              Pre-meal line (optional)
              <textarea
                rows={2}
                placeholder="Bread and butter"
                value={menuBooklet.preMealText ?? ""}
                onChange={(event) =>
                  setMenuBooklet((previous) => ({ ...previous, preMealText: event.target.value }))
                }
              />
            </label>
            <label>
              Post-meal line (optional)
              <textarea
                rows={2}
                placeholder="Fairtrade Tea & Coffee"
                value={menuBooklet.postMealText ?? ""}
                onChange={(event) =>
                  setMenuBooklet((previous) => ({ ...previous, postMealText: event.target.value }))
                }
              />
            </label>
          </div>
        </div>

        <h3 style={{ marginTop: 16 }}>Dish name overrides (short + long)</h3>
        <p>
          Run Preview to auto-populate dish names. You can override the short name (place cards/service plans/table views)
          and/or long name (menu card) before export.
        </p>
        <div className="grid">
          {Object.keys(dishNameOverrides).length === 0 && (
            <p className="pill">Run Preview first to populate dish options.</p>
          )}
          {Object.entries(dishNameOverrides).map(([originalName, override]) => (
            <div key={originalName} className="panel" style={{ marginBottom: 0 }}>
              <p style={{ marginTop: 0, marginBottom: 10, fontSize: 13, opacity: 0.8 }}>
                Source: <strong>{originalName}</strong>
              </p>
              <div className="grid two">
                <label>
                  Short name override
                  <textarea
                    rows={1}
                    value={override.shortName}
                    onChange={(event) =>
                      setDishNameOverrides((previous) => ({
                        ...previous,
                        [originalName]: {
                          ...previous[originalName],
                          shortName: event.target.value
                        }
                      }))
                    }
                  />
                </label>
                <label>
                  Long name override
                  <textarea
                    rows={2}
                    value={override.longName}
                    onChange={(event) =>
                      setDishNameOverrides((previous) => ({
                        ...previous,
                        [originalName]: {
                          ...previous[originalName],
                          longName: event.target.value
                        }
                      }))
                    }
                  />
                </label>
              </div>
            </div>
          ))}
        </div>

        <h3 style={{ marginTop: 20 }}>Menu: merge duplicate spellings</h3>
        <p style={{ marginTop: 0, marginBottom: 8, fontSize: 14, opacity: 0.88 }}>
          After short-name overrides, the same dish may still appear twice on the menu (for example{" "}
          <em>Beef</em> and <em>beef</em>). Select the exact lines that should print once; place cards
          and service plans keep each guest&apos;s wording. Long-name overrides on any merged spelling
          still apply to the single menu line when possible.
        </p>
        {uniqueEffectiveDishes.length < 2 ? (
          <p className="pill" style={{ marginBottom: 0 }}>
            Run Preview to list dishes (with overrides applied) here.
          </p>
        ) : (
          <div className="grid" style={{ marginBottom: 12 }}>
            <label>
              Dishes to merge (multi-select)
              <select
                multiple
                size={Math.min(12, Math.max(4, uniqueEffectiveDishes.length))}
                value={menuMergePick}
                onChange={(event) =>
                  setMenuMergePick(Array.from(event.target.selectedOptions).map((option) => option.value))
                }
                style={{ width: "100%", minHeight: 120 }}
              >
                {uniqueEffectiveDishes.map((dish) => (
                  <option key={dish} value={dish}>
                    {dish}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" onClick={addMenuDuplicateGroup}>
                Add merge group
              </button>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>
                The menu line defaults to the first spelling in A–Z order; edit it in the group below.
              </p>
            </div>
          </div>
        )}
        {dishMenuDuplicateGroups.length > 0 && (
          <div className="grid">
            {dishMenuDuplicateGroups.map((group) => (
              <div key={group.id} className="panel" style={{ marginBottom: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label>
                      Single menu line
                      <input
                        value={group.canonical}
                        onChange={(event) =>
                          setDishMenuDuplicateGroups((previous) =>
                            previous.map((entry) =>
                              entry.id === group.id ? { ...entry, canonical: event.target.value } : entry
                            )
                          )
                        }
                      />
                    </label>
                    <p style={{ margin: "10px 0 0", fontSize: 13, opacity: 0.8 }}>
                      Merges:{" "}
                      <strong>{group.match.join(" · ")}</strong>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setDishMenuDuplicateGroups((previous) => previous.filter((entry) => entry.id !== group.id))
                    }
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <h2 className="step-heading">
          <span className="step-heading-badge">5</span>
          <span>Export bundle</span>
        </h2>
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
          <label>
            Name normalization
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
              <input
                type="checkbox"
                checked={normalizeGuestNamesToTitleCase}
                onChange={(event) => setNormalizeGuestNamesToTitleCase(event.target.checked)}
              />
              <span>Apply title case to guest names on export (optional)</span>
            </div>
            <small style={{ display: "block", marginTop: 6, color: "#556070" }}>
              Useful for ALL CAPS source lists. Leave off if names like McSomething should remain untouched.
            </small>
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
