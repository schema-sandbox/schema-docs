# Schema Docs Public Preview Demo Flow

> **Before sending a document to AI, see what AI will see. Never send raw files directly to AI.**

Schema Docs is not a generic binary format converter. It is a local-first semantic document workspace designed as an **AI Context Intake Layer**, a **Privacy & Safety Gateway**, and a **Handoff & Exchange Interface** for people who already work with AI and documents. It ensures that context is clean, minimal, and safe before it leaves your machine.

---

## Demo 1: Word or PDF to Reviewed AI Context

**Scenario**: Show the core AI Context Intake path. A document containing sensitive data is parsed locally, desensitized using the Privacy & Safety Gateway, and packaged for verified handoff.

### Step-by-Step Walkthrough

1. **Local Context Intake**
   * **Action**: Drag and drop a raw `.docx` or `.pdf` file (e.g., `employment-contract.docx` containing customer names and phone numbers) into the workspace.
   * **Outcome**: The file is parsed locally using the zero-dependency parser. A clean text record is stored in your workspace, completely offline.

2. **In-Memory Desensitization**
   * **Action**: Open the document in the workspace editor, enable **PII/Secret Masking**, and generate a send preview.
   * **Outcome**: The Privacy & Safety Gateway scans the text in-memory. Sensitive phone numbers and names are replaced with placeholders (e.g., `[MASK_PHONE_1]`, `[MASK_EMAIL_1]`). The mapping remains strictly in memory.

3. **Verify with the "AI Will See" Panel**
   * **Action**: Open the **AI Will See** panel on the right sidebar.
   * **Outcome**: The panel displays the exact character-by-character payload that would be sent to the LLM. You can verify that all sensitive PII has been replaced with placeholders and that no hidden metadata or raw binaries will be sent.

4. **Package Handoff**
   * **Action**: Click **Save exchange package**.
   * **Outcome**: The Handoff & Exchange Interface packages the reviewed Markdown, provenance hashes, and audit logs into an SDXP exchange package, ready to be safely shared.

---

## Demo 2: Spreadsheet Local Query & Minimize

**Scenario**: Show how to query and prune tabular data locally before sending it to AI. Instead of dumping a huge raw spreadsheet to the cloud, use SQL to filter the dataset and feed only the relevant slice to the AI.

### Step-by-Step Walkthrough

1. **Table Intake**
   * **Action**: Import a CSV or XLSX spreadsheet containing 10,000 sales records.
   * **Outcome**: The schema is parsed locally, and a structured database view is created in your workspace.

2. **Local SQL Filter**
   * **Action**: In the SQL query tab, execute a command to filter the data:
     ```sql
     SELECT product_name, SUM(revenue) FROM csv_table WHERE country = 'US' GROUP BY product_name LIMIT 10
     ```
   * **Outcome**: The local database engine executes the query on your machine, producing a 10-row summary table.

3. **Prepare AI Context**
   * **Action**: Click **Prepare Query Context**.
   * **Outcome**: The 10 summary rows are rendered into a clean Markdown table. The **AI Will See** panel confirms that only the 10 rows are staged, consuming less than 150 tokens instead of the original full dataset.

4. **Handoff Bundle**
   * **Action**: Click **Save Handoff Bundle**.
   * **Outcome**: The Handoff & Exchange Interface saves the filtered table context along with the SQL query history as a verifiable audit trail.

---

## Demo 3: Credential Leak Prevention & Local Block

**Scenario**: Verify that the safety gateway prevents transmission of configuration files or prompts containing raw credentials.

### Step-by-Step Walkthrough

1. **Risky Context Intake**
   * **Action**: Import a text file containing database credentials and an API key (e.g., `sk-proj-123456...`).

2. **Send Gate Intervention**
   * **Action**: Open the document, click **Generate send preview**, review **AI Will See**, and then attempt **Confirm send**.
   * **Outcome**: The Privacy & Safety Gateway scans the active payload in-memory. It detects `api_key_like` and `bearer_token_like` signals.

3. **Egress Block & Local Evidence Log**
   * **Outcome**: The Send Gate returns a Block verdict. **Confirm send** is blocked. No API call is made. The blocked attempt is recorded in the local evidence log (`evidence.jsonl`) with key details redacted:
     ```json
     {"kind":"ai_send_blocked","aiSent":false,"policyDecision":"blocked_never_send","sendGateSignals":["api_key_like"]}
     ```
