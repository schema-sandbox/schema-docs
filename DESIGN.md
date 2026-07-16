# Design System: Schema Docs (v0.1.0)

## 1. Visual Theme & Atmosphere
Schema Docs is a local-first, zero-dependency document intake and AI auditing suite. The visual theme must convey clinical precision, cryptographic security, and high-trust data handling.

* **Vibe Scale**:
  - **Density:** 7/10 (Professional balanced dashboard; data density is high but readability is preserved through clean typography and monospace layouts for code/hashes).
  - **Variance:** 6/10 (Structured asymmetry; left-heavy headers, offset layouts for comparison metrics, and structured key-value alignment).
  - **Motion:** 5/10 (Fluid micro-animations; crisp transform translations on active buttons, spring-based hover highlights, and staggered transitions for timeline elements).
* **Atmosphere Description**:
  A clinical, dark-tech workspace utilizing a slate-zinc monochrome color palette contrasted with a single, high-trust emerald green accent representing safety and audit validation. Surfaces are flat, boundaries are defined by subtle borders, and elevation is minimal.

---

## 2. Color Palette & Roles
To maintain visual consistency and avoid cheap generic AI aesthetics, all colors are calibrated to a cool-zinc scale. Oversaturated gradients and blue/purple neon glows are strictly banned.

* **Primary Background (Canvas)**: `#09090B` (Zinc-950) — Main viewport backdrop.
* **Secondary Surface (Panels)**: `#18181B` (Zinc-900) — Container backdrop for sidebar modules, tables, and AI Will See workspace.
* **Primary Text (Ink)**: `#F4F4F5` (Zinc-100) — High contrast text, titles, and headers.
* **Secondary Text (Muted Steel)**: `#A1A1AA` (Zinc-400) — Descriptive copy, labels, column headers, and helper texts.
* **Borders (Whisper border)**: `rgba(63, 63, 70, 0.4)` (Zinc-800) — 1px structural division lines for boundaries.
* **Accent Color (Audit Emerald)**: `#10B981` (Emerald-500) — Represents validated, safe-to-send content, active state highlights, focus rings, and positive action CTAs.
* **Warning Color (Audit Gold)**: `#F59E0B` (Amber-500) — Represents PII warning states, manual override indicators, and quality score alerts.
* **Block Color (Audit Crimson)**: `#EF4444` (Red-500) — Represents blocked AI Send Gate reviews, critical errors, and missing credentials.

* **Banned Colors**: Pure black (`#000000`), oversaturated purple/violet neon glows (`#8B5CF6`), and generic primary blue (`#3B82F6`).

---

## 3. Typography Rules
* **Display / Headlines**: `Geist` or `Satoshi` — Tight tracking, bold weights, hierarchy driven by size and color contrast rather than massive size.
* **Body / Paragraphs**: `Geist` or `Outfit` — 14px/16px size, relaxed leading (`line-height: 1.5`), line-length constrained to a maximum of 65 characters (`65ch`) for optimal readability.
* **Monospace / Metadata**: `JetBrains Mono` or `Geist Mono` — Mandatory for file hashes (SHA-256), token estimates, code blocks, and local SQL query texts.
* **Banned Fonts**: `Inter` (overused/generic), system defaults (`Arial`, `Times New Roman`).

---

## 4. Component Stylings
* **Buttons**:
  - Tactile physical feedback: `-1px` transform translate on click/active states.
  - Primary button: Solid `#10B981` with `#09090B` text.
  - Secondary button: Ghost outline using border `rgba(63, 63, 70, 0.4)` with hover background transitions.
  - **Banned**: Outer neon drop-shadow glows, sliding gradient borders, and custom cursor styles.
* **Cards & Panel Layouts**:
  - Border radius: `12px` (Medium rounding, clinical rather than bubbly).
  - Background: Solid `#18181B`.
  - Shadows: Subtle, highly diffused, tinted to match the dark canvas background.
  - High-density lists: Replace cards with 1px border-top dividers to save screen space.
* **AI Summon Key**:
  - Positioned as a persistent, high-frequency entry point fixed in the bottom-right.
  - Styled with an Emerald ring outline, a dark/black base background, minimalist text/icon representation, and clear hover/focus states. Not too subtle.
* **Inputs & Form Controls**:
  - Always place labels directly above the input box (never inside or floating).
  - Border: 1px solid `rgba(63, 63, 70, 0.4)` transitioning to `#10B981` focus rings on active state.
  - Error messages: Inline, positioned directly below the input in Crimson `#EF4444`.
* **Loading Indicators**:
  - Use structured, skeletal animations matching the target block dimensions.
  - **Banned**: Generic spinning circles and progress bars.
* **Empty / Zero States**:
  - Standardized clean illustration block with instructions on how to populate data (e.g. "Drag doc here to start").

---

## 5. Layout Principles
* **Grid-First Architecture**: Flexbox and CSS Grid layout blocks with explicit gap distributions (e.g. `gap-4`, `gap-6`).
* **Asymmetric Columns**: Sidebar panels (320px width) offset against the primary workspace panel (fluid width).
* **Responsive Collapse**: Below `768px`, all multi-column dashboard layouts collapse into a single vertical layout block.
* **Viewport Safety**: Use `min-h-[100dvh]` to avoid mobile Safari viewport layout jumps.
* **Touch Targets**: All interactive buttons, picker inputs, and menu tabs must have a minimum clickable size of `44px x 44px`.

---

## 6. Motion & Interaction
* **Physics-Based Easing**: Transform properties and opacity transitions utilize spring physics (`stiffness: 100, damping: 20`) for a responsive, high-fidelity tactile feel. Reduce decorative motion to enhance visual stability and reliability for a security tool.
* **Hardware Acceleration**: Animate exclusively using GPU-friendly `transform` and `opacity` properties. Animating `top`, `left`, `width`, or `height` is banned.
* **Staggered Waterfall Reveals**: Timeline audit events and workspace list items fade in with structured cascade delays (e.g. `20ms` delay per item).

---

## 7. Anti-Patterns (Banned AI Clichés)
* No emojis anywhere in the default UI.
* No primary/secondary gradients on large headlines.
* No fake placeholders like "John Doe" or "Acme Corp" (use descriptive mock identifiers or actual sample names).
* No AI copywriting buzzwords (e.g., "seamless", "next-gen", "elevate", "unleash").
* No broken image icons or unsplash placeholders (use clean SVG mock illustrations).

---

## 8. Panel Architecture & View-Specific Layouts
To ensure incremental refactoring of the modular Javascript panels in `public/` is completely aligned, each panel component must adhere to specific spacing and state rules:

### A. First-Open Configuration (`productModePanel.js`)
* **Purpose**: Wizard modal to let users configure default settings (e.g. Office-first vs Markdown-first, setting the API key locally, or opening a workspace).
* **Layout**: Centered overlay modal box with background backdrop blur (`backdrop-filter: blur(8px)`).
* **Callouts**: Display two clear columns for Workspace Mode options (Office-First vs Markdown-First). Use a singular Primary CTA at the bottom.

### B. Workspace Dashboard Panel (`workspaceDashboardPanel.js`)
* **Purpose**: Displays the active workspace pathway, recent timeline events, and overall package counts.
* **Layout**: Positioned as a persistent top or sidebar element.
* **Typographic Rule**: Workspace paths and SHA-256 manifest hashes must render in `Mono` and wrap cleanly to avoid layout overflow.

### C. Document Flow Panel (`documentFlowPanel.js`)
* **Purpose**: Handles dragging, dropping, and importing document files (DOCX, PDF, CSV, etc.) and lists the workspace inbox records.
* **Layout**:
  - Drag-and-drop intake zone: Large dashed border (`border: 2px dashed rgba(63, 63, 70, 0.4)`) with transition states on dragover (changing to Audit Emerald `#10B981`).
  - Inbox lists: Rendered as a high-density vertical list with 1px border-top dividers. Each row includes quick-action buttons (e.g. "Extract Text", "Run Query").

### D. AI Context Panel (`aiContextPanel.js`)
* **Purpose**: Displays what the AI model will receive (the Markdown extract or the filtered local SQL table result).
* **Layout**:
  - Twin tab header (Markdown Viewer / Filtered SQL View) to separate text and structured queries.
  - Text area: Scrollable viewport (`max-height: 400px`) with font stack `Geist` or `Outfit` and character length limit indications.
  - Token count badge: Positioned at the top right, rendering in `Mono` to show estimated context consumption.

### E. AI Send Gate Panel (`aiSendGatePanel.js`)
* **Purpose**: Validates the payload for safety, displays PII flags, and collects manual override reasons if the audit warns of quality/security issues.
* **Layout**:
  - Standardized checklist layout displaying status symbols (Green Check, Amber Warning, Crimson Block).
  - Redacted values summary: Grid table listing placeholder keys (e.g., `[MASK_EMAIL_1] | Email | masked | restore available locally`) to never expose sensitive original values by default in the list mapping. Original values are only visible under secure reveal click events when local session is authorized.
  - Manual Override Input: Standard input form field containing label above and inline helper copy below. Rendered only when override capability is active.
