import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const roadmapPath = join(root, "docs", "LOCAL_AI_ROADMAP.md");
const promptDir = join(root, "docs", "prompts");
const checkOnly = process.argv.includes("--check");

function slug(value) {
  return value
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function phaseFor(packetId) {
  return Number(packetId[0]);
}

function parseRoadmap(source) {
  const phaseRequirements = new Map();
  const phasePattern = /^## \d+\. Phase ([2-6]) packets[^\n]*\n\nRequirements: ([^\n]+)$/gm;
  for (const match of source.matchAll(phasePattern)) {
    phaseRequirements.set(Number(match[1]), match[2]);
  }

  const packets = [];
  const packetPattern =
    /^### ([2-6][A-Z]) — ([^\n]+)\n\n([\s\S]*?)(?=^### [2-6][A-Z] — |^## \d+\.|(?![\s\S]))/gm;
  for (const match of source.matchAll(packetPattern)) {
    packets.push({
      id: match[1],
      title: match[2].trim(),
      contract: match[3].trim(),
      requirements: phaseRequirements.get(phaseFor(match[1])) ?? "",
    });
  }
  return packets;
}

function promptFilename(packet) {
  return `${packet.id}-${slug(packet.title)}.md`;
}

function generatedPrompt(packet) {
  const commitMessage =
    packet.contract.match(/Commit: `([^`]+)`\.?/)?.[1] ??
    `phase ${packet.id}: complete ${packet.title.toLowerCase()}`;

  return `# Local-AI Prompt ${packet.id} — ${packet.title}

Generated from \`docs/LOCAL_AI_ROADMAP.md\` by \`scripts/generate-local-ai-prompts.mjs\`.

Copy everything inside the block into a **new local-model chat** started in \`C:\\src\\mysite\`.

\`\`\`text
You are implementing exactly one bounded packet in the Personal Management Dashboard repository.

WORKING DIRECTORY
C:\\src\\mysite

PACKET
${packet.id} — ${packet.title}

BASELINE AND SAFETY

Before changing anything, run:

- git status --short
- git branch --show-current
- git log -1 --oneline

Treat the current green HEAD as the baseline. If the worktree contains changes you did not create, preserve them and work around them. Do not use git reset --hard, git checkout --, or destructive cleanup.

The repository may contain these unrelated untracked files:

- Modelfile
- tokens for admin.txt

Do not read, edit, stage, delete, or commit either file.

READ BEFORE ACTING

Read these sources before writing code:

1. AGENTS.md in full.
2. docs/LOCAL_AI_ROADMAP.md sections 2–4 and packet ${packet.id}.
3. ${packet.requirements}
4. The relevant sections of docs/ARCHITECTURE.md cited by the roadmap.
5. PROGRESS.md current state and newest log entry.
6. Existing production and test files in the module this packet changes.

For every Next.js API or convention you touch, first read the relevant installed guide under node_modules/next/dist/docs/. The installed Next.js documentation is authoritative; do not rely on training-memory conventions.

Inspect the existing implementation and tests before proposing new abstractions. Prefer extending existing actor, RBAC, audit/activity, validation, error, localization, and database patterns.

SOURCE PACKET CONTRACT

${packet.contract}

SCOPE CONTROL

Implement only packet ${packet.id}. Do not begin the next packet, create speculative later-phase tables, add placeholder APIs, or perform unrelated refactors/dependency upgrades.

A normal packet should stay within:

- one append-only migration and its generated metadata;
- eight production files, excluding migration metadata;
- four test files;
- one primary service or one primary UI surface when either is substantial.

If accurate implementation cannot fit, stop before editing and propose a smaller ${packet.id}.1/${packet.id}.2 split with reasons and independent gates.

MIGRATION AND DATA RULES

- Existing migration SQL is immutable history.
- If this packet changes schema, add one new migration; otherwise do not create a migration.
- Never rewrite, rename, or delete an old migration.
- For schema changes, review generated SQL, preserve snapshot parent IDs and journal order, and extend the migration-upgrade integration test.
- Seed changes must be idempotent and remove obsolete grants as well as add new grants.
- Store timestamps in UTC and apply the user's IANA timezone at presentation/scheduling boundaries.
- Do not invent unavailable external or media metadata.

AUTHORIZATION AND SECURITY

- Every service receives an authenticated actor or actor-derived context.
- Every resource query includes owner, membership, or explicit-grant scoping.
- Guessing another user's ID must return the documented 403/404 without leaking the record.
- UI hiding is never authorization.
- Mutations use existing validation, same-origin, action guard, rate-limit where sensitive, and audit/activity patterns.
- Add explicit cross-user and read_only denial tests.
- Never persist or log passwords, tokens, MFA/recovery secrets, authorization headers, or unbounded request bodies.

LOCALIZATION AND UI

- Hebrew remains the default; English remains complete and selectable.
- Add Hebrew and English dictionary keys together.
- Use logical RTL CSS properties.
- Keep machine values as LTR islands.
- Include empty/loading/error states, labels, keyboard access, and confirmation for destructive actions when this packet has UI.

TEST REQUIREMENTS

Implement every test named by the source packet contract. Add regression coverage for:

- happy path;
- invalid input and boundary values;
- another-user isolation;
- read_only denial for writes;
- persistence across a fresh database connection;
- migration from the prior committed schema when a migration is added;
- Hebrew/English parity when strings are added;
- no stack trace or secret leakage at HTTP boundaries.

Use temporary SQLite databases with production pragmas. E2E tests must use visible controls against the production standalone server; do not bypass the UI with invented test-only APIs.

MICRO-GATE

Run commands sequentially. Never run next dev and next build concurrently. Never run npm run build in parallel with npm run typecheck.

1. Packet-specific unit tests.
2. Packet-specific integration tests.
3. npm test
4. npm run typecheck
5. npm run lint
6. npm run format:check
7. npm run build
8. Packet-specific E2E when the packet changes UI or HTTP behavior.

If a command fails, diagnose the real cause. Do not weaken an assertion, authorization predicate, validation rule, or migration guarantee merely to make it green. Rerun the failed command and every later gate command.

PROGRESS AND COMMIT

Update PROGRESS.md with the packet status, migration name if any, commands actually run, measured test counts, and honest limitations. Do not mark the parent phase complete unless this is its macro-gate packet.

Do not stage Modelfile or tokens for admin.txt.

If and only if every required gate is green, create one commit with this message:

${commitMessage}

Do not push to GitHub unless explicitly instructed.

FINAL HANDOFF

Stop after packet ${packet.id}. Report:

Packet:
Commit:
Implemented:
Migration:
Changed files:
Targeted tests:
Full tests/build:
E2E:
Known limitations:
Files the next packet should read first:

Include exact command results and test counts. Do not begin the next packet.
\`\`\`
`;
}

function indexContent(packets) {
  const rows = packets
    .map((packet) => `| ${packet.id} | ${packet.title} | [prompt](./${promptFilename(packet)}) |`)
    .join("\n");

  return `# Local-AI Prompt Library

Each file is a self-contained copy/paste prompt for one roadmap packet. Start a fresh model chat in \`C:\\src\\mysite\` for each packet and use only one prompt at a time.

Packet 2A is intentionally hand-authored with extra detail. All other prompt files are generated from \`docs/LOCAL_AI_ROADMAP.md\`.

Regenerate after changing the roadmap:

\`\`\`powershell
node scripts/generate-local-ai-prompts.mjs
node scripts/generate-local-ai-prompts.mjs --check
\`\`\`

| Packet | Scope | File |
| --- | --- | --- |
${rows}
`;
}

const roadmap = readFileSync(roadmapPath, "utf8");
const packets = parseRoadmap(roadmap);
if (packets.length !== 58) {
  throw new Error(`Expected 58 roadmap packets, found ${packets.length}`);
}

const manual2A = join(promptDir, promptFilename(packets[0]));
if (!existsSync(manual2A)) {
  throw new Error(`Missing hand-authored 2A prompt: ${manual2A}`);
}

const expected = new Map([["README.md", indexContent(packets)]]);
for (const packet of packets.slice(1)) {
  expected.set(promptFilename(packet), generatedPrompt(packet));
}

const failures = [];
for (const [file, content] of expected) {
  const path = join(promptDir, file);
  if (checkOnly) {
    if (!existsSync(path) || readFileSync(path, "utf8") !== content) failures.push(file);
  } else {
    writeFileSync(path, content, "utf8");
  }
}

if (checkOnly) {
  const allowed = new Set([basename(manual2A), ...expected.keys()]);
  for (const file of readdirSync(promptDir)) {
    if (file.endsWith(".md") && !allowed.has(file)) failures.push(`unexpected:${file}`);
  }
  if (failures.length > 0) {
    throw new Error(`Prompt library is stale: ${failures.join(", ")}`);
  }
  console.log(`prompt library current: ${packets.length} packets`);
} else {
  console.log(`generated ${expected.size - 1} packet prompts and README index`);
}
