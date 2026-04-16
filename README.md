# Event Docs Generator

Hosted Next.js tool for generating event collateral from one client CSV:

- Table plan by table (A4/A3 portrait/landscape, auto pagination or manual tables per sheet)
- Table plan by person (alphabetical)
- Place cards (Word-export sheet: 595.44×846.24 pt; six guests per page on rows 2/4/6 with logo backs on rows 1/3/5; table/menu/dietary at 10–12 pt with auto-fit name; primary/accent borders; text calibration)
- Menu card (two A4 landscape sheets, duplex: each sheet is back|front or inside-left|inside-right halves)
- Service plan (grouped by dish, dietary highlighted, dish totals by table)

## Features included

- CSV upload with column mapping wizard
- Validation report (missing required data, duplicates, missing choices/tables)
- Dietary normalization from free-text variants
- Last-minute edit screen before export
- Profile library (JSON-backed) for reusable branding and print settings
- Export selected outputs as either a single file or ZIP bundle

## Run locally

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

Use `examples/sample-client.csv` for a quick test import.
