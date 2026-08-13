# Company operations adapter contract

Google Sheets and company formats are intentionally not hard-coded. Configure one `integration_adapters` row only after the real sheet headers and business rules are approved.

## Contract

- `adapter_key`: stable company-owned identifier, e.g. `group-class-weekly`
- `version`: mapping version; never silently change an existing version
- `entity_type`: one of the V12 operational entities
- `field_mapping`: external header to canonical database field mapping
- `config_schema`: required connection/config values, without secrets
- `is_active`: remains `false` until validation passes
- Every run needs a unique `idempotency_key`; retries must reuse the same key
- Preserve original input in the entity's `raw_payload` where available
- Reject unknown required headers; do not guess their meaning
- Payroll calculations require a named `rule_version` and approved rules

Secrets belong in Vercel environment variables, never in this table, GitHub, or browser code.

## Supported canonical targets

`sales_records`, `group_classes`, `group_class_attendance`, `work_logs`, `shifts`, `leave_requests`, `payroll_records`, and `accounting_exports`.

## Example shape (not a business mapping)

```json
{
  "adapter_key": "pending-company-sheet",
  "version": "draft-1",
  "provider": "google_sheets",
  "direction": "import",
  "entity_type": "work_logs",
  "field_mapping": {},
  "config_schema": {"required": ["spreadsheet_id", "sheet_name"]},
  "is_active": false
}
```
