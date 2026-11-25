<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project Agent Instructions

## 1. Context and Token Management

- Conserve context and output tokens throughout the session.
- Read only files and documentation relevant to the current task.
- Read specific sections of large files instead of their entire contents.
- Use targeted searches to locate relevant code before reading files.
- Avoid repeatedly reading unchanged files.
- Limit terminal output to relevant results and error messages.
- Do not generate unnecessarily verbose explanations.
- Keep reasoning focused and concise.

## 2. Tool Execution and Output Limits

- Prefer targeted `edit` operations over complete file rewrites.
- Use `write` primarily for creating new files.
- Keep individual tool calls small and complete.
- Prefer no more than 100–150 lines of generated code per tool call where practical.
- Split large file creation into smaller operations.
- Never attempt to generate an entire complex application in a single response or tool call.
- If a tool call is truncated, retry using a smaller operation.
- Verify that a tool operation succeeded before proceeding.
- Never assume that a truncated tool call modified the filesystem.

## 3. Implementation Workflow

For each substantial task:

1. Inspect the relevant existing implementation.
2. Identify requirements and dependencies.
3. Prepare a concise implementation plan.
4. Divide the implementation into small, independently testable steps.
5. Implement one step at a time.
6. Run relevant validation and tests.
7. Correct identified errors before continuing.
8. Update project status documentation.

Continue autonomously through the implementation steps unless a material decision requires user input.

## 4. Code Quality

- Preserve existing functionality unless explicitly instructed otherwise.
- Follow existing project architecture and coding conventions.
- Prefer modular, maintainable and reusable components.
- Avoid unnecessary dependencies.
- Do not duplicate existing functionality.
- Do not introduce placeholders, mock implementations or unfinished functions unless explicitly requested.
- Verify APIs against the installed framework and dependency versions.
- Never invent library APIs, configuration options or framework capabilities.
- Address underlying problems rather than suppressing errors.

## 5. Next.js and TypeScript

- Follow the Next.js instructions above.
- Inspect the installed Next.js documentation relevant to the task.
- Maintain TypeScript type safety.
- Avoid unnecessary use of `any`.
- Respect server-side and client-side component boundaries.
- Keep sensitive operations and credentials on the server.
- Validate external input on the server.
- Preserve responsive design and accessibility.
- Run appropriate type checking, linting, tests and build validation after significant changes.

## 6. Persistent Project State

Maintain a concise `PROJECT_STATUS.md` file in the project root.

It should contain:

- Current project objective.
- Essential architectural decisions.
- Completed implementation stages.
- Current implementation stage.
- Files materially changed during the current task.
- Outstanding tasks.
- Known errors and unresolved issues.
- The next concrete implementation step.

Update this file after each significant implementation stage and before ending a substantial task.

Keep it concise. Do not turn it into a chronological conversation log.

## 7. Session and Context Recovery

When starting a new session or recovering from context compaction:

1. Read `AGENTS.md`.
2. Read `PROJECT_STATUS.md`, if present.
3. Inspect the current Git status.
4. Inspect only the source files relevant to the pending task.
5. Continue from the last verified implementation state.

Treat the actual filesystem as the authoritative source of implementation state.

Do not recreate existing functionality merely because previous conversation context is unavailable.

## 8. Error Recovery

- If generation is truncated, reduce the size of the next operation.
- If a tool call fails, inspect the error before retrying.
- Do not repeatedly issue identical failing tool calls.
- Do not enter repetitive debugging loops.
- If an approach fails repeatedly, investigate an alternative approach.
- Preserve all successfully completed work.
- Never report successful implementation without verifying the result.

## 9. Security and Data Integrity

- Never expose API keys, passwords, tokens or credentials.
- Do not commit secrets to source control.
- Do not delete unrelated files or overwrite user changes.
- Do not perform destructive database operations without explicit authorization.
- Do not execute destructive Git commands without explicit authorization.

## 10. Response Style

- Be concise and technically precise.
- Prioritize implementation over narration.
- Avoid repeating information already provided.
- Report completed changes, validation results and unresolved issues.
- Clearly distinguish verified results from assumptions.
- Do not reproduce complete source files in the conversation when they have already been written to disk.