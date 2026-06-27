# Apple Contacts Round-Trip Checklist

Use this checklist for changes that affect vCard import, editing, serialization, or export. It covers behavior that cannot be fully validated by the browser-only automated test suite because Apple Contacts is an external macOS application.

## Setup

1. Run `npm test` from the repository root.
2. Serve the app locally and open it over `http://` (the app uses ES modules, so
   it won't load from `file://`): from `contacts-graph/`, run
   `python3 -m http.server 7891`, then open `http://localhost:7891`. No network
   access beyond localhost is needed.
3. Import `contacts-graph/test/fixtures/comprehensive.vcf`.
4. Export all contacts from the app to a temporary `.vcf` file.

## Apple Contacts Import/Export

1. In Apple Contacts, create or select a disposable test account/group.
2. Import the exported `.vcf` file from the app.
3. Inspect the imported contacts before exporting them again.
4. Export the imported test contacts back out of Apple Contacts as a new `.vcf`.
5. Re-import that Apple-exported `.vcf` into this app.

## Required Checks

- Names with escaped commas and semicolons remain readable, especially `Dr. Jane, Q. Doe;Smith`.
- Structured name fields remain correct: prefix, given name, family name, and display name.
- `X-ABSHOWAS:COMPANY` contacts still display as companies, with full company names.
- Preferred email, phone, and address items remain preferred in Apple Contacts and remain preferred when re-imported into the app.
- Hidden Apple/system types such as `INTERNET`, `VOICE`, and `PREF` are not exposed as custom user labels in the app.
- Custom type labels survive import/export when Apple Contacts preserves them.
- Photos appear in Apple Contacts and reappear in the app after Apple re-export.
- Notes preserve escaped commas, semicolons, newlines, and hashtags.
- Notes and other long text fields containing non-ASCII characters remain readable after app export, Apple import, Apple export, and app re-import.
- Hashtag filters regenerate from re-imported Notes fields.
- Relationships imported by Apple Contacts are preserved when Apple re-exports them.
- Virtual relationship targets remain represented as unresolved/virtual graph nodes if no real vCard exists for them.
- Birthday and anniversary values remain attached to the correct contacts.
- Non-anniversary Apple custom date fields, when present, are not removed by unrelated edits in the app.
- Geographic addresses preserve street, city, state/province, postal code, country, and preferred address type.

## Failure Capture

For any failed check, save:

- the app-exported `.vcf`
- the Apple-exported `.vcf`
- the exact contact name and field that changed unexpectedly
- whether Apple Contacts visibly changed the field on import, or only changed it on export
