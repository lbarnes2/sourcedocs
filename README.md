# Event Collateral

Hosted Next.js tools for the print jobs every event needs.

| Tool | What it makes |
| --- | --- |
| **Banqueting documents** (`/banqueting`) | Table plans (by table and A–Z by person), place cards, menu card, service plan, table tent cards and a kitchen summary from one guest list (CSV or Excel). |
| **Buffet menus** (`/buffet-menu`) | Display menu, allergen matrix and A6 / A7 buffet labels from one menu with allergens. |
| **Event signage** (`/signage`) | A venue's full directional sign pack, one-off signs (one or two events), and general signs with symbols and Wi-Fi QR codes. |
| **Floorplans** (`/floorplans`) | Drag-and-drop table layouts with seat counts, guest-list checks and scaled printing. |
| **Logo library** (`/logo-library`) | Venue and client logos shared by every tool. |
| **Settings** (`/settings`) | Menu card contact lines, allergen statement and display menu backgrounds. |

## Banqueting documents

- CSV / Excel upload with automatic column mapping (first sheet only for Excel)
- Guest lists with a table column, or with "Table 4" heading rows above each table
- Validation report: missing tables, duplicates, missing choices, skipped and uneven rows
- Dietary requirements kept as written (only obvious spellings such as GF / DF are unified)
- Set menu for 1-1-1 dinners, dish short / long names and menu merge groups
- Last-minute edits: change, add, remove and move guests, with a headcount per table
- Re-upload a revised guest list and review what was added, removed and changed; manual edits are kept
- Menu card: drag dishes into order and add (v) / (ve) / (gf) keys
- A–Z plan by first name or by surname with letter headings
- Live preview beside the settings, with the same layout warnings as an export
- Kitchen summary as a PDF and as a CSV
- Saved projects (whole workspace) and profiles (reusable colours and print settings)
- Export as PDF or PNG, as a ZIP or a single file; layout problems are reported after export

Place cards use the Word-export sheet (595.44×846.24 pt): six guests per page on rows 2/4/6 with logo
backs on rows 1/3/5. The menu card is two A4 landscape sheets for duplex printing.

## Run locally

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000). Use `examples/sample-client.csv` for a quick
test import.

Other scripts:

```bash
npm run typecheck
npm run lint
npm run build
```

## Storage

Copy `.env.example` to `.env.local` and fill in the Cloudflare R2 values to store everything in R2
and enable the logo library.

Without R2 the app still works: projects, profiles, venue signage profiles, floorplans, buffet menus,
sign templates and settings are saved as JSON under `data/` on the server. Only the logo library needs R2.
