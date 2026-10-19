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

## Sign-in

Every page and API route needs a signed-in account. Accounts live in R2 at `auth/users.json` (or `data/users.json` when R2 is not configured), with passwords hashed using scrypt.

Roles:

- **Viewer**: view everything, load saved items and generate PDFs
- **Editor**: everything a viewer can do, plus save and delete projects, menus, floorplans, logos, venues, profiles and sign templates
- **Admin**: everything, including Settings, buffet settings and user management

Setup:

1. Set `AUTH_SECRET` (at least 32 random characters, e.g. `openssl rand -base64 48`) in `.env.local` and in the Vercel project settings. Changing it signs everyone out.
2. Create the first admin from your machine:

   ```bash
   npm run create-admin -- you@example.com "Your Name"
   ```

   Running it again for an existing email resets that account's password and makes it an admin, which is the way back in if every admin is locked out. With R2 configured in `.env.local`, this writes to the same bucket the live site uses.

Admins add and manage everyone else under **Settings → Users**. A new account, or a password reset, gets a temporary password that's shown once; the user must replace it when they first sign in. Admins can change roles, deactivate, reactivate or delete accounts, but not their own, and there is always at least one active admin. Anyone can change their own password from the account link in the sidebar.

Saved projects, buffet menus and floorplans record who saved them ("19 Oct 2026, 14:02 by Jane Smith" in each Open list). Viewers see the same screens with saving, deleting and uploading removed, and the buffet menu's dishes and allergen tick boxes are locked so they can only print what was saved; Settings is read-only for everyone except admins.

Sessions last 12 hours. Five wrong passwords lock an account for 15 minutes (a password reset clears it). Every save and delete re-checks the live account, so a role change or deactivation takes effect within about 30 seconds.

## Run locally

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

Use `examples/sample-client.csv` for a quick test import.
