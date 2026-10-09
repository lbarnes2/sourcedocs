"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import { Download, FileSpreadsheet, FolderOpen, Save, Trash2, X } from "lucide-react";
import { LogoPicker } from "@/app/components/LogoPicker";
import {
  Callout,
  ColorField,
  Disclosure,
  Dropzone,
  Field,
  Modal,
  PageHeader,
  Section,
  Segmented,
  Switch,
  Tabs,
  Toasts
} from "@/app/components/ui";
import { autoDetectMapping, canonicalColumns, getRequiredMappingIssues } from "@/lib/csv/mapping";
import { excelFileToCsvText, isExcelFile } from "@/lib/csv/excelToCsv";
import { normalizeDietary, validateGuests } from "@/lib/csv/validation";
import {
  defaultFloorplanSettings,
  defaultMenuBookletSettings,
  defaultPlaceCardSettings,
  defaultTablePlanSettings,
  defaultThemeSettings
} from "@/lib/defaults";
import { rewriteDishWithShortOverride } from "@/lib/dish/applyOverrides";
import { readResponseError } from "@/lib/http/readError";
import { PAPER_SIZE_OPTIONS } from "@/lib/paperSizes";
import { downloadBlob, downloadPdfBlobAsPngs, downloadPdfBlobsAsPngZip } from "@/lib/pdf/pdfToPngExport";
import type {
  ColumnMapping,
  DishMenuDuplicateGroup,
  DishNameOverride,
  DocumentType,
  EventProjectFile,
  GuestRecord,
  PaperSize,
  ProfileSettings,
  ProjectListItem,
  RawCsvRow
} from "@/types";

const DOCUMENTS: Array<{ id: DocumentType; label: string; description: string }> = [
  { id: "tablePlanByTable", label: "Table plan · by table", description: "Guests listed under each table" },
  { id: "tablePlanByPerson", label: "Table plan · by person", description: "A–Z guest list with table numbers" },
  { id: "placeCards", label: "Place cards", description: "Six per sheet, with logo backs" },
  { id: "menuBooklet", label: "Menu card", description: "Two A4 landscape sheets, half-page layout" },
  { id: "servicePlan", label: "Service plan", description: "Dish totals by table, dietary highlighted" }
];

const COLUMN_LABELS: Record<string, string> = {
  table: "Table",
  name: "Full name",
  firstName: "First name",
  lastName: "Last name",
  starter: "Starter",
  main: "Main",
  dessert: "Dessert",
  dietary: "Dietary"
};

type SettingsTab = "branding" | "tablePlans" | "placeCards" | "menu" | "dishes";

const PAPER_OPTIONS = PAPER_SIZE_OPTIONS.map((o) => ({ value: o.value, label: o.value }));
const ORIENTATION_OPTIONS = [
  { value: "portrait" as const, label: "Portrait" },
  { value: "landscape" as const, label: "Landscape" }
];
const DENSITY_OPTIONS = [
  { value: "auto" as const, label: "Auto" },
  { value: "manual" as const, label: "Manual" }
];

const DOCUMENT_IMAGE_BASENAMES: Record<DocumentType, string> = {
  tablePlanByTable: "table-plan-by-table",
  tablePlanByPerson: "table-plan-by-person",
  placeCards: "place-cards",
  menuBooklet: "menu-booklet",
  servicePlan: "service-plan",
  floorplan: "floorplan"
};

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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read image."));
    reader.readAsDataURL(blob);
  });
}

function exportBaseName(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "event-docs";
}

function logoAssetUrl(kind: "client" | "venue", key: string): string {
  return `/api/logos/${kind}/asset?key=${encodeURIComponent(key)}`;
}

/** Reads per-document layout notices sent by /api/generate. */
function readGenerationWarnings(response: Response): string[] {
  const raw = response.headers.get("X-Generation-Warnings");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/** Library logos are sent by key and loaded server-side, keeping request bodies small. */
function themeForRequest(
  theme: typeof defaultThemeSettings,
  clientLogoKey: string | null,
  venueLogoKey: string | null
): typeof defaultThemeSettings {
  return {
    ...theme,
    clientLogoDataUrl: clientLogoKey ? undefined : theme.clientLogoDataUrl,
    venueLogoDataUrl: venueLogoKey ? undefined : theme.venueLogoDataUrl
  };
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
  const [exportWarnings, setExportWarnings] = useState<string[]>([]);

  const [theme, setTheme] = useState({ ...defaultThemeSettings });
  const [tablePlan, setTablePlan] = useState({ ...defaultTablePlanSettings });
  const [tablePlanByPerson, setTablePlanByPerson] = useState({ ...defaultTablePlanSettings });
  const [placeCard, setPlaceCard] = useState({ ...defaultPlaceCardSettings });
  const [menuBooklet, setMenuBooklet] = useState({ ...defaultMenuBookletSettings });
  const [floorplan, setFloorplan] = useState({ ...defaultFloorplanSettings });
  const [dishNameOverrides, setDishNameOverrides] = useState<Record<string, DishNameOverride>>({});
  const [dishMenuDuplicateGroups, setDishMenuDuplicateGroups] = useState<
    Array<DishMenuDuplicateGroup & { id: string }>
  >([]);
  const [menuMergePick, setMenuMergePick] = useState<string[]>([]);
  const [normalizeGuestNamesToTitleCase, setNormalizeGuestNamesToTitleCase] = useState(false);

  const [selectedDocuments, setSelectedDocuments] = useState<DocumentType[]>(DOCUMENTS.map((doc) => doc.id));
  const [bundleMode, setBundleMode] = useState<"single" | "zip">("zip");
  const [outputFormat, setOutputFormat] = useState<"pdf" | "png">("pdf");

  const [profiles, setProfiles] = useState<ProfileSettings[]>([]);
  const [profileName, setProfileName] = useState("New Profile");
  const [clientLogoLuminance, setClientLogoLuminance] = useState<number | null>(null);
  const [menuLogoLegibilityWarning, setMenuLogoLegibilityWarning] = useState("");

  const [venueLogoLibrary, setVenueLogoLibrary] = useState<{
    loaded: boolean;
    configured: boolean;
    items: Array<{ key: string; label: string; assetUrl: string }>;
  }>({ loaded: false, configured: false, items: [] });
  const [clientLogoLibrary, setClientLogoLibrary] = useState<{
    loaded: boolean;
    configured: boolean;
    items: Array<{ key: string; label: string; assetUrl: string }>;
  }>({ loaded: false, configured: false, items: [] });
  const [selectedClientLogoKey, setSelectedClientLogoKey] = useState<string | null>(null);
  const [selectedVenueLogoKey, setSelectedVenueLogoKey] = useState<string | null>(null);
  const [venueLibraryBusy, setVenueLibraryBusy] = useState(false);

  const [projectList, setProjectList] = useState<ProjectListItem[]>([]);
  const [projectStorage, setProjectStorage] = useState<"r2" | "local" | "">("");
  const [projectLibraryName, setProjectLibraryName] = useState("");
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [profileSaveOpen, setProfileSaveOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("branding");
  const [guestFileName, setGuestFileName] = useState("");

  /** True after user has used Preview and Validate at least once this session (shows mapping + report UI). */
  const [hasAttemptedPreviewValidate, setHasAttemptedPreviewValidate] = useState(false);
  /** True only after a successful preview with parsed guests — unlocks export. */
  const [exportUnlocked, setExportUnlocked] = useState(false);

  const mappingIssues = useMemo(() => getRequiredMappingIssues(mapping), [mapping]);

  const uniqueTableCount = useMemo(
    () => new Set(guests.map((guest) => guest.tableNumber)).size,
    [guests]
  );

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
    setFloorplan({ ...defaultFloorplanSettings, ...file.floorplan });
    setDishNameOverrides(file.dishNameOverrides ?? {});
    setDishMenuDuplicateGroups(file.dishMenuDuplicateGroups ?? []);
    setMenuMergePick([]);
    setNormalizeGuestNamesToTitleCase(file.normalizeGuestNamesToTitleCase ?? false);
    const nextSelected = file.selectedDocuments?.filter((doc) => doc !== "floorplan") ?? [];
    setSelectedDocuments(nextSelected.length ? nextSelected : DOCUMENTS.map((doc) => doc.id));
    setBundleMode(file.bundleMode === "single" ? "single" : "zip");
    setProfileName(file.profileName ?? "New Profile");
    setSelectedVenueLogoKey(file.selectedVenueLogoKey ?? null);
    setSelectedClientLogoKey(file.selectedClientLogoKey ?? null);
    setCurrentProjectId(file.id);
    setProjectLibraryName(file.name);
    setGuestFileName("");
    setError("");
    setExportWarnings([]);
    // The saved guest list already includes last-minute edits, so export straight away —
    // re-running Preview would rebuild guests from the raw CSV and discard those edits.
    const hasGuests = file.guests.length > 0;
    setHasAttemptedPreviewValidate(hasGuests);
    setExportUnlocked(hasGuests);
    setClientLogoLuminance(null);
    // Projects saved with a library key store only the key; fetch the image for preview/legibility checks.
    if (file.selectedClientLogoKey && !file.theme.clientLogoDataUrl) {
      void applyLogoFromLibrary(
        { key: file.selectedClientLogoKey, assetUrl: logoAssetUrl("client", file.selectedClientLogoKey) },
        "clientLogoDataUrl"
      );
    } else if (file.theme.clientLogoDataUrl) {
      const luma = await estimateLogoLuminance(file.theme.clientLogoDataUrl);
      setClientLogoLuminance(luma);
    }
    if (file.selectedVenueLogoKey && !file.theme.venueLogoDataUrl) {
      void applyLogoFromLibrary(
        { key: file.selectedVenueLogoKey, assetUrl: logoAssetUrl("venue", file.selectedVenueLogoKey) },
        "venueLogoDataUrl"
      );
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
        theme: themeForRequest(theme, selectedClientLogoKey, selectedVenueLogoKey),
        tablePlan,
        tablePlanByPerson,
        placeCard,
        menuBooklet,
        floorplan,
        dishNameOverrides,
        dishMenuDuplicateGroups,
        normalizeGuestNamesToTitleCase,
        selectedDocuments,
        bundleMode,
        profileName,
        selectedVenueLogoKey,
        selectedClientLogoKey
      };
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(await readResponseError(response, "Save failed."));
      const data = await response.json();
      setCurrentProjectId(data.id);
      setProjectLibraryName(name);
      await refreshProjectList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setProjectBusy(false);
    }
  }

  async function loadSelectedProject(id: string) {
    setProjectBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error(await readResponseError(response, "Load failed."));
      const data = await response.json();
      await applyLoadedProject(data.project as EventProjectFile);
      setProjectsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed.");
    } finally {
      setProjectBusy(false);
    }
  }

  async function deleteSelectedProject(id: string) {
    if (!window.confirm("Delete this saved project from storage? This cannot be undone.")) return;
    setProjectBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readResponseError(response, "Delete failed."));
      if (currentProjectId === id) {
        setCurrentProjectId(null);
      }
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

  async function refreshClientLogoLibrary() {
    setVenueLibraryBusy(true);
    try {
      const response = await fetch("/api/logos/client");
      const payload = await response.json();
      setClientLogoLibrary({
        loaded: true,
        configured: Boolean(payload.configured),
        items: Array.isArray(payload.items) ? payload.items : []
      });
    } catch {
      setClientLogoLibrary({ loaded: true, configured: false, items: [] });
    } finally {
      setVenueLibraryBusy(false);
    }
  }

  useEffect(() => {
    void Promise.all([refreshVenueLogoLibrary(), refreshClientLogoLibrary()]);
  }, []);

  async function applyLogoFromLibrary(
    item: { assetUrl: string; key: string },
    field: "venueLogoDataUrl" | "clientLogoDataUrl"
  ) {
    setError("");
    try {
      const response = await fetch(item.assetUrl);
      if (!response.ok) throw new Error("Could not load that logo from storage.");
      const blob = await response.blob();
      const dataUrl = await blobToDataUrl(blob);
      setTheme((previous) => ({ ...previous, [field]: dataUrl }));
      if (field === "venueLogoDataUrl") {
        setSelectedVenueLogoKey(item.key);
      } else {
        setSelectedClientLogoKey(item.key);
        const luma = await estimateLogoLuminance(dataUrl);
        setClientLogoLuminance(luma);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply logo.");
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

  async function handleGuestDataFile(file: File) {
    setError("");
    setHasAttemptedPreviewValidate(false);
    setExportUnlocked(false);
    try {
      const text = isExcelFile(file) ? await excelFileToCsvText(file) : await file.text();
      setCsvText(text);
      setGuestFileName(file.name);
      const parsed = parseCsvClient(text);
      setHeaders(parsed.headers);
      setMapping(autoDetectMapping(parsed.headers));
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "Could not read that file.");
    }
  }

  async function runPreview() {
    if (!csvText) {
      setHasAttemptedPreviewValidate(true);
      setError("Upload a guest list file first (CSV or Excel).");
      return;
    }
    if (mappingIssues.length) {
      setHasAttemptedPreviewValidate(true);
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
      if (!response.ok) throw new Error(await readResponseError(response, "Failed to preview"));
      const payload = await response.json();
      const nextGuests: GuestRecord[] = payload.guests ?? [];
      if (
        guests.length > 0 &&
        JSON.stringify(guests) !== JSON.stringify(nextGuests) &&
        !window.confirm(
          "Re-validating rebuilds the guest list from the uploaded file. Any last-minute edits below (names, tables, dishes, dietary) will be lost. Continue?"
        )
      ) {
        return;
      }
      setGuests(nextGuests);
      setIssues(payload.validation?.issues ?? []);
      setExportUnlocked(nextGuests.length > 0);
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
      setExportUnlocked(false);
      setError(previewError instanceof Error ? previewError.message : "Preview failed.");
    } finally {
      setHasAttemptedPreviewValidate(true);
      setLoadingPreview(false);
    }
  }

  async function saveCurrentProfile() {
    const name = profileName.trim();
    if (!name) {
      setError("Enter a profile name first.");
      return;
    }
    // Saving under an existing name updates that profile; otherwise mint a fresh id so
    // names that slug to the same string (e.g. non-Latin names) cannot overwrite each other.
    const existing = profiles.find((entry) => entry.name.trim().toLowerCase() === name.toLowerCase());
    const id = existing?.id ?? crypto.randomUUID();
    const profile: ProfileSettings = {
      id,
      name,
      // Profiles hold reusable branding + print settings only; event details and logos stay with the event.
      theme: {
        ...defaultThemeSettings,
        primaryColor: theme.primaryColor,
        accentColor: theme.accentColor,
        textColor: theme.textColor
      },
      tablePlan,
      tablePlanByPerson,
      placeCard,
      menuBooklet,
      floorplan
    };
    const response = await fetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile)
    });
    if (!response.ok) {
      setError(await readResponseError(response, "Could not save profile."));
      return;
    }
    setError("");
    setProfileSaveOpen(false);
    setProfiles((previous) => {
      const withoutExisting = previous.filter((entry) => entry.id !== id);
      return [...withoutExisting, profile].sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  function applyProfile(profileId: string) {
    const found = profiles.find((profile) => profile.id === profileId);
    if (!found) return;
    // Only branding colours come from the profile — keep this event's name, date and logos.
    setTheme((previous) => ({
      ...previous,
      primaryColor: found.theme.primaryColor,
      accentColor: found.theme.accentColor,
      textColor: found.theme.textColor
    }));
    setTablePlan(found.tablePlan);
    setTablePlanByPerson(found.tablePlanByPerson ?? found.tablePlan);
    setPlaceCard(found.placeCard);
    setMenuBooklet({ ...defaultMenuBookletSettings, ...found.menuBooklet });
    setFloorplan({ ...defaultFloorplanSettings, ...found.floorplan });
    setProfileName(found.name);
  }

  function addMenuDuplicateGroup() {
    if (menuMergePick.length < 2) {
      setError("Tick at least two dishes to merge onto one menu line.");
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
    if (outputFormat === "pdf" && bundleMode === "single" && selectedDocuments.length !== 1) {
      setError("Single-file mode requires exactly one selected document.");
      return;
    }
    // Last-minute edits bypass the original preview validation, so re-check before printing.
    const requiredCourses = (["starter", "main", "dessert"] as const).filter((course) => Boolean(mapping[course]));
    const recheck = validateGuests(
      guests.map((guest) => ({ ...guest, tableNumber: guest.tableNumber.trim(), name: guest.name.trim() })),
      { requiredCourses }
    );
    setIssues(recheck.issues);
    setHasAttemptedPreviewValidate(true);
    const blocking = recheck.issues.filter((issue) => issue.severity === "error");
    if (blocking.length) {
      setError(
        `Fix ${blocking.length} guest list error${blocking.length === 1 ? "" : "s"} before exporting (see Validation report): ${blocking[0].message}`
      );
      return;
    }
    setExportWarnings([]);

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
    const buildGenerateBody = (documents: DocumentType[], requestedBundleMode: "single" | "zip") => ({
      mode: "generate",
      guests,
      request: {
        documents,
        bundleMode: requestedBundleMode,
        theme: themeForRequest(theme, selectedClientLogoKey, selectedVenueLogoKey),
        clientLogoKey: selectedClientLogoKey,
        venueLogoKey: selectedVenueLogoKey,
        tablePlan,
        tablePlanByPerson,
        placeCard,
        menuBooklet,
        floorplan,
        dishNameOverrides,
        dishMenuDuplicateGroups: dishMenuDuplicateGroups.map(({ canonical, match }) => ({
          canonical,
          match
        })),
        normalizeGuestNamesToTitleCase
      }
    });
    const fetchGeneratedPdf = async (documentType: DocumentType): Promise<Blob> => {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildGenerateBody([documentType], "single"))
      });
      if (!response.ok) throw new Error(await readResponseError(response, "Export failed."));
      const warnings = readGenerationWarnings(response);
      if (warnings.length) setExportWarnings((previous) => [...previous, ...warnings]);
      return response.blob();
    };

    try {
      if (outputFormat === "png") {
        const pdfs = await Promise.all(
          selectedDocuments.map(async (documentType) => ({
            blob: await fetchGeneratedPdf(documentType),
            baseName: DOCUMENT_IMAGE_BASENAMES[documentType]
          }))
        );
        window.clearInterval(progressTimer);
        setExportProgressPct(100);
        if (pdfs.length === 1) {
          await downloadPdfBlobAsPngs(pdfs[0].blob, pdfs[0].baseName);
        } else {
          await downloadPdfBlobsAsPngZip(pdfs, `${exportBaseName(theme.eventName)}-png.zip`);
        }
        return;
      }

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildGenerateBody(selectedDocuments, bundleMode))
      });

      if (!response.ok) throw new Error(await readResponseError(response, "Export failed."));
      setExportWarnings(readGenerationWarnings(response));

      const blob = await response.blob();
      window.clearInterval(progressTimer);
      setExportProgressPct(100);
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="(.+)"/);
      const filename = match?.[1] ?? (bundleMode === "single" ? "document.pdf" : "documents.zip");
      downloadBlob(blob, filename);
    } catch (exportError) {
      window.clearInterval(progressTimer);
      setError(exportError instanceof Error ? exportError.message : "Export failed.");
    } finally {
      window.clearInterval(progressTimer);
      setLoadingExport(false);
      window.setTimeout(() => setExportProgressPct(0), 800);
    }
  }

  function updateGuest(index: number, patch: Partial<GuestRecord>) {
    setGuests((previous) => {
      const next = previous.slice();
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }

  const columns = canonicalColumns();
  const mappedCount = columns.filter((column) => Boolean(mapping[column])).length;
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.length - errorCount;
  const logoLibraryReady =
    venueLogoLibrary.loaded && venueLogoLibrary.configured && clientLogoLibrary.loaded && clientLogoLibrary.configured;
  const logoLibraryMissing =
    (venueLogoLibrary.loaded && !venueLogoLibrary.configured) || (clientLogoLibrary.loaded && !clientLogoLibrary.configured);
  const dishCount = Object.keys(dishNameOverrides).length;
  const singleFileBlocked = outputFormat === "pdf" && bundleMode === "single" && selectedDocuments.length !== 1;

  const guestColumns: Array<{ key: "name" | "tableNumber" | "starter" | "main" | "dessert"; label: string }> = [
    { key: "name", label: "Name" },
    { key: "tableNumber", label: "Table" },
    { key: "starter", label: "Starter" },
    { key: "main", label: "Main" },
    { key: "dessert", label: "Dessert" }
  ];

  return (
    <main className="page">
      <PageHeader
        title="Banqueting documents"
        description="Upload a guest list, check it, then print table plans, place cards, menus and service plans."
        actions={
          <>
            <input
              className="header-input"
              value={projectLibraryName}
              onChange={(event) => setProjectLibraryName(event.target.value)}
              placeholder="Project name"
              aria-label="Project name"
            />
            <button type="button" disabled={projectBusy} onClick={() => void saveProjectToLibrary()}>
              <Save size={15} aria-hidden />
              {projectBusy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                void refreshProjectList();
                setProjectsOpen(true);
              }}
            >
              <FolderOpen size={15} aria-hidden />
              Open
            </button>
          </>
        }
      />
      {currentProjectId ? (
        <p className="text-muted header-note">
          Saving updates the open project.{" "}
          <button
            type="button"
            className="text-button"
            disabled={projectBusy}
            onClick={() => {
              setCurrentProjectId(null);
              setError("");
            }}
          >
            Save as a new project instead
          </button>
        </p>
      ) : null}

      {projectsOpen ? (
        <Modal title="Saved projects" onClose={() => setProjectsOpen(false)}>
          <p className="text-muted" style={{ marginTop: 0 }}>
            A project holds the whole workspace: guest list and edits, branding, logos, print settings and dish names.
          </p>
          {projectStorage === "local" ? (
            <Callout tone="warning">
              R2 isn&apos;t configured — projects are stored on this server in <code>data/projects/</code>.
            </Callout>
          ) : null}
          {projectList.length === 0 ? (
            <p className="text-muted">No saved projects yet.</p>
          ) : (
            <ul className="list">
              {projectList.map((item) => (
                <li key={item.id} className={item.id === currentProjectId ? "list-item list-item--active" : "list-item"}>
                  <div className="list-item-main">
                    <button
                      type="button"
                      className="list-item-title"
                      disabled={projectBusy}
                      onClick={() => void loadSelectedProject(item.id)}
                    >
                      {item.name}
                    </button>
                    <span className="list-item-meta">
                      {item.eventName ? `${item.eventName} · ` : ""}
                      {new Date(item.savedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                  </div>
                  <button type="button" className="btn-sm" disabled={projectBusy} onClick={() => void loadSelectedProject(item.id)}>
                    Open
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm btn-danger"
                    aria-label={`Delete ${item.name}`}
                    disabled={projectBusy}
                    onClick={() => void deleteSelectedProject(item.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      ) : null}

      {/* 1 — Guest list */}
      <Section step={1} title="Guest list" description="CSV or Excel. Excel workbooks use the first sheet only.">
        <div className="stack">
          <div className="form-grid">
            <Field label="Event name">
              <input
                value={theme.eventName}
                onChange={(event) => setTheme((previous) => ({ ...previous, eventName: event.target.value }))}
                placeholder="Smith Wedding 2026"
              />
            </Field>
            <Field label="Event date">
              <input
                value={theme.eventDate ?? ""}
                onChange={(event) => setTheme((previous) => ({ ...previous, eventDate: event.target.value }))}
                placeholder="Thursday 9th April 2026"
              />
            </Field>
          </div>

          <Dropzone
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onFile={(file) => void handleGuestDataFile(file)}
            icon={<FileSpreadsheet size={20} aria-hidden />}
            title={guestFileName ? guestFileName : headers.length ? "Guest list loaded" : "Choose a guest list file"}
            subtitle={
              headers.length
                ? `${headers.length} columns found · click or drop to replace`
                : "Click to browse, or drop a .csv / .xlsx file here"
            }
          />

          {headers.length > 0 ? (
            <Disclosure
              label={
                <>
                  Column mapping{" "}
                  <span className={mappingIssues.length ? "badge badge--warning" : "badge badge--success"}>
                    {mappedCount} of {columns.length} mapped
                  </span>
                </>
              }
              defaultOpen={mappingIssues.length > 0}
            >
              <div className="form-grid form-grid--3">
                {columns.map((column) => (
                  <Field key={column} label={COLUMN_LABELS[column] ?? column}>
                    <select
                      value={mapping[column] ?? ""}
                      onChange={(event) => {
                        const value = event.target.value || undefined;
                        setMapping((previous) => ({ ...previous, [column]: value }));
                      }}
                    >
                      <option value="">Not mapped</option>
                      {headers.map((header) => (
                        <option key={`${column}-${header}`} value={header}>
                          {header}
                        </option>
                      ))}
                    </select>
                  </Field>
                ))}
              </div>
            </Disclosure>
          ) : null}

          {hasAttemptedPreviewValidate && mappingIssues.length > 0 ? (
            <Callout tone="warning">
              <ul>
                {mappingIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </Callout>
          ) : null}

          {logoLibraryReady ? (
            <div>
              <h3 className="subhead">Logos</h3>
              <div className="form-grid">
                <LogoPicker
                  title="Client logo"
                  items={clientLogoLibrary.items}
                  value={selectedClientLogoKey ?? ""}
                  onChange={(key) => {
                    if (!key) {
                      setSelectedClientLogoKey(null);
                      setTheme((previous) => ({ ...previous, clientLogoDataUrl: undefined }));
                      setClientLogoLuminance(null);
                      return;
                    }
                    const item = clientLogoLibrary.items.find((entry) => entry.key === key);
                    if (item) void applyLogoFromLibrary(item, "clientLogoDataUrl");
                  }}
                  emptyOption={{ label: "No client logo", value: "" }}
                  disabled={venueLibraryBusy}
                />
                <LogoPicker
                  title="Venue logo"
                  items={venueLogoLibrary.items}
                  value={selectedVenueLogoKey ?? ""}
                  onChange={(key) => {
                    if (!key) {
                      setSelectedVenueLogoKey(null);
                      setTheme((previous) => ({ ...previous, venueLogoDataUrl: undefined }));
                      return;
                    }
                    const item = venueLogoLibrary.items.find((entry) => entry.key === key);
                    if (item) void applyLogoFromLibrary(item, "venueLogoDataUrl");
                  }}
                  emptyOption={{ label: "No venue logo", value: "" }}
                  disabled={venueLibraryBusy}
                />
              </div>
            </div>
          ) : null}
          {logoLibraryMissing ? (
            <Callout tone="warning">
              R2 isn&apos;t configured — profiles are stored in <code>data/profiles</code> and the logo library is
              disabled. See <code>.env.example</code>.
            </Callout>
          ) : null}
          {menuLogoLegibilityWarning ? <Callout tone="warning">{menuLogoLegibilityWarning}</Callout> : null}
        </div>
        <div className="card-foot card-foot--inset">
          <button type="button" className="btn-primary" disabled={loadingPreview} onClick={runPreview}>
            {loadingPreview ? "Checking…" : exportUnlocked ? "Re-check guest list" : "Check guest list"}
          </button>
        </div>
      </Section>

      {/* 2 — Review */}
      <Section
        step={2}
        title="Review guests"
        description={
          hasAttemptedPreviewValidate && (guests.length || issues.length)
            ? undefined
            : "Check the guest list above to see any problems and make last-minute edits."
        }
      >
        {hasAttemptedPreviewValidate && (guests.length || issues.length) ? (
          <div className="stack">
            <div className="row">
              <span className="badge">
                {guests.length} guest{guests.length === 1 ? "" : "s"}
              </span>
              <span className="badge">
                {uniqueTableCount} table{uniqueTableCount === 1 ? "" : "s"}
              </span>
              {errorCount ? (
                <span className="badge badge--danger">
                  {errorCount} error{errorCount === 1 ? "" : "s"}
                </span>
              ) : null}
              {warningCount ? (
                <span className="badge badge--warning">
                  {warningCount} warning{warningCount === 1 ? "" : "s"}
                </span>
              ) : null}
              {!issues.length ? <span className="badge badge--success">No problems found</span> : null}
            </div>
            {issues.length > 0 ? (
              <ul className="issue-list issue-list--scroll">
                {issues.map((issue, index) => (
                  <li key={`${issue.message}-${index}`}>
                    <span className={issue.severity === "error" ? "badge badge--danger" : "badge badge--warning"}>
                      {issue.severity === "error" ? "Error" : "Warning"}
                    </span>
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {guests.length > 0 ? (
              <Disclosure label={`Last-minute edits (${guests.length} guests)`}>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {guestColumns.map((column) => (
                          <th key={column.key}>{column.label}</th>
                        ))}
                        <th>Dietary</th>
                      </tr>
                    </thead>
                    <tbody>
                      {guests.map((guest, guestIndex) => (
                        <tr key={guest.id}>
                          {guestColumns.map((column) => (
                            <td key={column.key}>
                              <input
                                value={guest[column.key]}
                                aria-label={`${column.label} for ${guest.name || `guest ${guestIndex + 1}`}`}
                                onChange={(event) => updateGuest(guestIndex, { [column.key]: event.target.value })}
                              />
                            </td>
                          ))}
                          <td>
                            <input
                              value={guest.dietaryOriginal}
                              aria-label={`Dietary for ${guest.name || `guest ${guestIndex + 1}`}`}
                              onChange={(event) =>
                                updateGuest(guestIndex, {
                                  dietaryOriginal: event.target.value,
                                  dietaryNormalized: normalizeDietary(event.target.value)
                                })
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Disclosure>
            ) : null}
          </div>
        ) : null}
      </Section>

      {/* 3 — Settings */}
      <Section
        step={3}
        title="Design and print settings"
        actions={
          <>
            {/* Resets after each pick so the same profile can be re-applied to undo tweaks. */}
            <select
              className="select-sm"
              value=""
              onChange={(event) => applyProfile(event.target.value)}
              aria-label="Load profile"
            >
              <option value="">Load profile…</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
            <button type="button" className="btn-sm" onClick={() => setProfileSaveOpen(true)}>
              Save as profile
            </button>
          </>
        }
      >
        <Tabs<SettingsTab>
          value={settingsTab}
          onChange={setSettingsTab}
          aria-label="Settings"
          tabs={[
            { value: "branding", label: "Branding" },
            { value: "tablePlans", label: "Table plans" },
            { value: "placeCards", label: "Place cards" },
            { value: "menu", label: "Menu card" },
            { value: "dishes", label: "Dish names", badge: dishCount || undefined }
          ]}
        />

        {settingsTab === "branding" ? (
          <div className="stack">
            <div className="color-row">
              <ColorField
                label="Primary"
                value={theme.primaryColor}
                onChange={(value) => setTheme((previous) => ({ ...previous, primaryColor: value }))}
              />
              <ColorField
                label="Accent"
                value={theme.accentColor}
                onChange={(value) => setTheme((previous) => ({ ...previous, accentColor: value }))}
              />
            </div>
            <p className="field-hint" style={{ margin: 0 }}>
              Primary is the menu card front background; accent is used for borders and highlights.
            </p>
          </div>
        ) : null}

        {settingsTab === "tablePlans" ? (
          <div className="form-grid">
            <div className="inset stack">
              <h3 style={{ margin: 0 }}>By table</h3>
              <Field label="Paper" as="div">
                <Segmented
                  value={tablePlan.paperSize}
                  options={PAPER_OPTIONS}
                  onChange={(value) => setTablePlan((previous) => ({ ...previous, paperSize: value as PaperSize }))}
                />
              </Field>
              <Field label="Orientation" as="div">
                <Segmented
                  value={tablePlan.orientation}
                  options={ORIENTATION_OPTIONS}
                  onChange={(value) => setTablePlan((previous) => ({ ...previous, orientation: value }))}
                />
              </Field>
              <Field label="Tables per sheet" as="div">
                <div className="row">
                  <Segmented
                    value={tablePlan.tablesPerSheetMode}
                    options={DENSITY_OPTIONS}
                    onChange={(value) => setTablePlan((previous) => ({ ...previous, tablesPerSheetMode: value }))}
                  />
                  {tablePlan.tablesPerSheetMode === "manual" ? (
                    <input
                      type="number"
                      min={1}
                      className="input-narrow"
                      aria-label="Tables per sheet"
                      value={tablePlan.tablesPerSheet}
                      onChange={(event) =>
                        setTablePlan((previous) => ({ ...previous, tablesPerSheet: Number(event.target.value) || 1 }))
                      }
                    />
                  ) : null}
                </div>
              </Field>
            </div>
            <div className="inset stack">
              <h3 style={{ margin: 0 }}>By person</h3>
              <Field label="Paper" as="div">
                <Segmented
                  value={tablePlanByPerson.paperSize}
                  options={PAPER_OPTIONS}
                  onChange={(value) => setTablePlanByPerson((previous) => ({ ...previous, paperSize: value as PaperSize }))}
                />
              </Field>
              <Field label="Orientation" as="div" hint="Landscape gives a two-column layout.">
                <Segmented
                  value={tablePlanByPerson.orientation}
                  options={ORIENTATION_OPTIONS}
                  onChange={(value) => setTablePlanByPerson((previous) => ({ ...previous, orientation: value }))}
                />
              </Field>
              <Field label="Rows per page" as="div">
                <div className="row">
                  <Segmented
                    value={tablePlanByPerson.tablesPerSheetMode}
                    options={DENSITY_OPTIONS}
                    onChange={(value) => setTablePlanByPerson((previous) => ({ ...previous, tablesPerSheetMode: value }))}
                  />
                  {tablePlanByPerson.tablesPerSheetMode === "manual" ? (
                    <input
                      type="number"
                      min={1}
                      className="input-narrow"
                      aria-label="Rows per page"
                      value={tablePlanByPerson.tablesPerSheet}
                      onChange={(event) =>
                        setTablePlanByPerson((previous) => ({
                          ...previous,
                          tablesPerSheet: Number(event.target.value) || 1
                        }))
                      }
                    />
                  ) : null}
                </div>
              </Field>
            </div>
            <p className="field-hint span-all" style={{ margin: 0 }}>
              Floorplans have their own tool now — see{" "}
              <Link href="/floorplans" className="text-link">
                Floorplans
              </Link>
              .
            </p>
          </div>
        ) : null}

        {settingsTab === "placeCards" ? (
          <div className="stack">
            <p className="field-hint" style={{ margin: 0 }}>
              Six guests per sheet: rows 2, 4 and 6 carry name, table, menu and dietary; rows 1, 3 and 5 are tent backs
              with the client logo.
            </p>
            <div className="form-grid">
              <Field label="Stock name">
                <input
                  value={placeCard.stockName}
                  onChange={(event) => setPlaceCard((previous) => ({ ...previous, stockName: event.target.value }))}
                />
              </Field>
            </div>
            <Disclosure label="Card dimensions (reference only)">
              <div className="form-grid form-grid--3">
                <Field label="Card width (mm)">
                  <input
                    type="number"
                    value={placeCard.cardWidthMm}
                    onChange={(event) =>
                      setPlaceCard((previous) => ({ ...previous, cardWidthMm: Number(event.target.value) || 0 }))
                    }
                  />
                </Field>
                <Field label="Card height (mm)">
                  <input
                    type="number"
                    value={placeCard.cardHeightMm}
                    onChange={(event) =>
                      setPlaceCard((previous) => ({ ...previous, cardHeightMm: Number(event.target.value) || 0 }))
                    }
                  />
                </Field>
                <Field label="Fold offset (mm, unused)">
                  <input
                    type="number"
                    value={placeCard.foldOffsetMm}
                    onChange={(event) =>
                      setPlaceCard((previous) => ({ ...previous, foldOffsetMm: Number(event.target.value) || 0 }))
                    }
                  />
                </Field>
              </div>
            </Disclosure>
          </div>
        ) : null}

        {settingsTab === "menu" ? (
          <div className="form-grid">
            <Field label="Before the first course" hint="e.g. bread and butter">
              <textarea
                rows={3}
                placeholder="Bread and butter"
                value={menuBooklet.preMealText ?? ""}
                onChange={(event) => setMenuBooklet((previous) => ({ ...previous, preMealText: event.target.value }))}
              />
            </Field>
            <Field label="After the last course" hint="e.g. tea and coffee">
              <textarea
                rows={3}
                placeholder="Fairtrade Tea & Coffee"
                value={menuBooklet.postMealText ?? ""}
                onChange={(event) => setMenuBooklet((previous) => ({ ...previous, postMealText: event.target.value }))}
              />
            </Field>
          </div>
        ) : null}

        {settingsTab === "dishes" ? (
          dishCount === 0 ? (
            <p className="text-muted" style={{ margin: 0 }}>
              Check the guest list first — every dish it contains will appear here so you can rename it.
            </p>
          ) : (
            <div className="stack">
              <p className="field-hint" style={{ margin: 0 }}>
                <strong>Short name</strong> is used on place cards, service plans and table plans.{" "}
                <strong>Long name</strong> is used on the menu card.
              </p>
              <div className="dish-table">
                <div className="dish-table-head">
                  <span>From guest list</span>
                  <span>Short name</span>
                  <span>Long name</span>
                </div>
                {Object.entries(dishNameOverrides).map(([originalName, override]) => (
                  <div key={originalName} className="dish-table-row">
                    <span className="dish-table-source">{originalName}</span>
                    <textarea
                      rows={1}
                      autoComplete="off"
                      aria-label={`Short name for ${originalName}`}
                      value={override.shortName}
                      onChange={(event) =>
                        setDishNameOverrides((previous) => ({
                          ...previous,
                          [originalName]: { ...previous[originalName], shortName: event.target.value }
                        }))
                      }
                    />
                    <textarea
                      rows={1}
                      autoComplete="off"
                      aria-label={`Long name for ${originalName}`}
                      value={override.longName}
                      onChange={(event) =>
                        setDishNameOverrides((previous) => ({
                          ...previous,
                          [originalName]: { ...previous[originalName], longName: event.target.value }
                        }))
                      }
                    />
                  </div>
                ))}
              </div>

              <Disclosure label="Merge duplicate spellings on the menu" defaultOpen={dishMenuDuplicateGroups.length > 0}>
                <div className="stack">
                  <p className="field-hint" style={{ margin: 0 }}>
                    If the same dish still appears twice after renaming (e.g. <em>Beef</em> and <em>beef</em>), tick both
                    to print it once on the menu. Place cards and service plans keep each guest&apos;s wording.
                  </p>
                  {uniqueEffectiveDishes.length >= 2 ? (
                    <>
                      <div className="chip-group">
                        {uniqueEffectiveDishes.map((dish) => (
                          <label key={dish} className="chip">
                            <input
                              type="checkbox"
                              checked={menuMergePick.includes(dish)}
                              onChange={(event) =>
                                setMenuMergePick((previous) =>
                                  event.target.checked ? [...previous, dish] : previous.filter((item) => item !== dish)
                                )
                              }
                            />
                            {dish}
                          </label>
                        ))}
                      </div>
                      <div className="row">
                        <button type="button" className="btn-sm" disabled={menuMergePick.length < 2} onClick={addMenuDuplicateGroup}>
                          Merge {menuMergePick.length >= 2 ? `${menuMergePick.length} dishes` : "selected"}
                        </button>
                        <span className="field-hint">The menu line defaults to the first spelling A–Z; edit it below.</span>
                      </div>
                    </>
                  ) : null}
                  {dishMenuDuplicateGroups.map((group) => (
                    <div key={group.id} className="inset row row--top" style={{ flexWrap: "nowrap" }}>
                      <div className="stack stack--sm" style={{ flex: 1, minWidth: 0 }}>
                        <Field label="Prints on the menu as">
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
                        </Field>
                        <span className="field-hint">Merges: {group.match.join(" · ")}</span>
                      </div>
                      <button
                        type="button"
                        className="icon-btn icon-btn--sm"
                        aria-label="Remove merge group"
                        onClick={() =>
                          setDishMenuDuplicateGroups((previous) => previous.filter((entry) => entry.id !== group.id))
                        }
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              </Disclosure>
            </div>
          )
        ) : null}
      </Section>

      {profileSaveOpen ? (
        <Modal
          title="Save as profile"
          size="sm"
          onClose={() => setProfileSaveOpen(false)}
          footer={
            <>
              <button type="button" onClick={() => setProfileSaveOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={() => void saveCurrentProfile()}>
                Save profile
              </button>
            </>
          }
        >
          <div className="stack">
            <p className="text-muted" style={{ margin: 0 }}>
              Profiles store colours and print settings to reuse on future events. Event details and logos stay with the
              event.
            </p>
            <Field label="Profile name" hint="Using an existing name updates that profile.">
              <input
                value={profileName}
                autoFocus
                onChange={(event) => setProfileName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void saveCurrentProfile();
                }}
              />
            </Field>
          </div>
        </Modal>
      ) : null}

      {/* 4 — Export */}
      <Section step={4} title="Download">
        <div className="stack">
          <div className="doc-grid">
            {DOCUMENTS.map((document) => {
              const checked = selectedDocuments.includes(document.id);
              return (
                <label key={document.id} className={checked ? "doc-option doc-option--on" : "doc-option"}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      setSelectedDocuments((previous) =>
                        checked ? previous.filter((item) => item !== document.id) : [...previous, document.id]
                      );
                    }}
                  />
                  <span className="doc-option-text">
                    <span className="doc-option-title">{document.label}</span>
                    <span className="doc-option-desc">{document.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="row" style={{ gap: 24, alignItems: "flex-start" }}>
            <Field label="Format" as="div">
              <Segmented
                value={outputFormat}
                options={[
                  { value: "pdf", label: "PDF" },
                  { value: "png", label: "PNG" }
                ]}
                onChange={setOutputFormat}
              />
            </Field>
            <Field
              label="Files"
              as="div"
              hint={outputFormat === "png" ? "PNG exports come as a ZIP of page images." : undefined}
            >
              <Segmented
                value={bundleMode}
                disabled={outputFormat === "png"}
                options={[
                  { value: "zip", label: "ZIP of all" },
                  { value: "single", label: "Single PDF", title: "Only when exactly one document is ticked" }
                ]}
                onChange={setBundleMode}
              />
            </Field>
          </div>
          <Switch
            checked={normalizeGuestNamesToTitleCase}
            onChange={setNormalizeGuestNamesToTitleCase}
            label="Convert guest names to title case"
            hint="Handy for ALL CAPS lists. Leave off if names like McSomething must stay as typed."
          />
          {singleFileBlocked ? (
            <Callout tone="warning">Single PDF needs exactly one document ticked.</Callout>
          ) : null}
        </div>
        <div className="card-foot card-foot--inset card-foot--between">
          <div className="export-progress">
            {exportProgressPct > 0 ? (
              <>
                <div className="progress">
                  <div className="progress-bar" style={{ width: `${exportProgressPct}%` }} />
                </div>
                <span className="text-muted text-sm">
                  {exportProgressPct < 100 ? `Generating… ${exportProgressPct}%` : "Done"}
                </span>
              </>
            ) : !exportUnlocked ? (
              <span className="text-muted text-sm">Check the guest list (step 1) to enable downloads.</span>
            ) : null}
          </div>
          <button
            type="button"
            className="btn-primary btn-lg"
            disabled={loadingExport || loadingPreview || !exportUnlocked}
            title={!exportUnlocked ? "Check the guest list first." : undefined}
            onClick={exportDocuments}
          >
            <Download size={16} aria-hidden />
            {loadingExport ? "Generating…" : "Generate and download"}
          </button>
        </div>
      </Section>

      {exportWarnings.length > 0 ? (
        <Callout tone="warning">
          <strong>Check these before printing:</strong>
          <ul>
            {exportWarnings.map((warning, index) => (
              <li key={`${warning}-${index}`}>{warning}</li>
            ))}
          </ul>
        </Callout>
      ) : null}

      <Toasts>
        {error ? (
          <Callout tone="error" onDismiss={() => setError("")}>
            {error}
          </Callout>
        ) : null}
      </Toasts>
    </main>
  );
}
