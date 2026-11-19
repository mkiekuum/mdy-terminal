# 2026-11-19 nightly compatibility review

Based on v4.6.0 (7273e5a). No release or installed-extension replacement.

Public review found cloud.js and records-ui.js changed. The records form submits task boardName (board full name). The terminal rejected it at schema validation, and its update/review allowlist omitted an existing board name. Added this optional string to the contract and preservation allowlist; regenerated schemas and command reference.

Regression reproduced INVALID_SCHEMA before the fix. Isolated MCP preview/execute now accepts and reads back the field; partial updates and approval previews preserve it. Existing permission, stale-basis and unknown-result protections remain. 203 tests pass; one platform-specific test is skipped on Windows. Build passes.

Reviewed cloud integration: plan edits still use /change with baseRevision/current/operation; work-task updates retain revision/edge/field/value. Management-only import, project assignment and review routes remain distinct. Sidebar/list changes require no change to the terminal hide-only legacy component control. Baseline hashes record source-level review, not production write certification.

Codex isolated browser verified authenticated /api/session with no password change required. No production writes, installed MCP dependency or system mouse input. Both requested groups were read for today's messages; returned text contained no actionable interface announcement. Image-only content was not treated as an API requirement. Latest local control rules remain applicable; no business assignments were applied.

Limits: backend source and production writes were not tested. Records still lack atomic version preconditions; complete before-state checks and write readback remain mandatory.
