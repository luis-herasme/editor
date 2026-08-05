# AGENTS.md

Compiled from feedback Luis has given across all Claude Code sessions and projects. The "Coding style" section is global (it applies to any repo); the first and last sections are specific to this repo.

## What this project is

A terminal emulator built with xterm.js + Electron. It is explicitly a **learning project**: the goal is to understand how terminal applications work, not just to ship one. Features are added incrementally, only when actually needed. The trajectory has shifted from "toy" toward a large codebase with a public command API (the command bus) so an agent can drive the editor (see ARCHITECTURE.md).

## Workflow

- **Plan before code.** Discuss and scope before implementation begins; don't jump from scoping straight into writing files.
- **Teach while building.** Define every domain term (TTY, PTY, escape sequence, IPC, ...) for someone unfamiliar with terminal applications. Add new terms to `GLOSSARY.md` as they appear, and explain new concepts in responses.
- **Keep ARCHITECTURE.md current.** It is the living document recording structure and decisions; update it as features land. The aim is "simple but with very good architecture."
- **Mermaid for diagrams.** Documentation diagrams are Mermaid blocks, not ASCII art.
- **Brief responses.** Keep answers terse by default; expand only when asked.
- **Autonomy with safe defaults.** When a choice is clear and safe, proceed without asking. Pause only for genuinely ambiguous or destructive decisions.
- **Simplify before finishing.** Before presenting work as done, do a simplification pass: the simplest solution possible while keeping the code easy to read. The two constraints are equal; terseness that hurts readability is not a simplification.
- **Document scope drift.** When the implementation intentionally diverges from what was asked (extra scope, different approach, deliberate exclusions), call it out explicitly in the PR description, not just in chat.

## Coding style

### Naming

- No abbreviations or diminutives: `response` not `res`, `request` not `req`, `event` not `e`, `parameters` not `params`.
- No single-letter variable names anywhere: lambda params (`(message) =>` not `(m) =>`), destructured renames, loop variables, and short object keys (`{ question, answer }` not `{ q, a }`).
  - Exception: an established repo-wide convention may stay (in the moni monorepo, `f` for react-intl's `formatMessage` is intentional). Don't invent new ones.
- Encode units in constant names: `_CENTS`, `_MS`, `_SECONDS`, `_BPS`, `_BYTES`.
- Use full identifier names in path params and schemas (`{rampSessionId}`, never `{id}`).

### Control flow: explicit over clever

- Readability beats fewer lines. Adding a helper, wrapper, or library-specific sentinel just to shorten code makes it harder to read, because the reader must know that abstraction to follow the flow. Prefer explicit, top-to-bottom code that needs no outside lore.
- No ternaries. Use early-return `if` blocks:

  ```ts
  if (!result.success) {
    return null;
  }
  return result.data;
  ```

- No single-line if returns. Always brace and indent, even for trivial guards:

  ```ts
  if (!parsed) {
    return null;
  }
  ```

- Avoid `??` and `||` value fallbacks. Expand to `let x = a; if (!x) { x = b; }`. Boolean conditions like `if (a && b)` are fine; this is about value-producing operators.
- Never `!!value`; use `Boolean(value)`.
- Prefer plain `for...of` loops with `continue` guards and `.push()` over `map`/`filter`/`reduce`/`flatMap` chains.
- No single-use predicate functions for `.find()`/`.filter()`. Select from a list with a `for` loop, explicit `if`/`continue` guards, and an early `return`.

### Types

- Never use type assertions (`as`). Use Zod validation, type narrowing, or a library constructor (e.g. viem `getAddress()`) instead. `as const` is the accepted exception.
- Never use the non-null assertion operator (`!`). Use a runtime guard or restructure so the type narrows naturally.
- Default to Zod for runtime narrowing of `unknown` values; never hand-rolled `typeof x === 'object' && 'field' in x` chains.
- Functions fetching external data return `unknown`; callers validate with a named Zod schema defined at top level (never inline at the call site) and derive types via `z.infer<>`.
- Types that cross the wire (request/response/error payloads) are defined as Zod schemas first, with the TS type derived. Internal-only types stay plain `type` aliases.
- No inline type definitions in function signatures. Object params and non-trivial return shapes (2+ fields) get a named type declared above the function:

  ```ts
  type DoThingParams = {
    rampSessionId: string;
    amount: bigint;
  };

  async function doThing(params: DoThingParams) { ... }
  ```

- Functions with 2+ parameters take a single options object with a named type.
- Reuse types the library already exports (viem's `Address`) instead of recreating them inline.
- Prefer typed primitives over raw embedded code strings (Lua, hand-written SQL): an embedded string is not statically verified. Only reach for one when no typed primitive can express the requirement, and say so.

### Abstractions

- No trivial or pass-through wrappers. A helper that returns a constant, forwards to one call, or wraps an object literal should not exist; export the constant or inline the literal.
- No functions whose body is a single line of logic. One statement does not earn a name, a signature, and an indirection; inline it at the call site. This includes single-expression predicates, formatters, and "future-proofing" wrappers.
- Don't create a file to hold a single trivial constant; declare it in its one consumer.
- Don't pre-declare exports (factory slots, enum members, union arms) for a future consumer. Ship them in the PR that introduces the first consumer.
- Don't re-export types under an old name for "backwards compatibility"; rename the consumers and delete the stub.
- Extract steps into helpers only when they carry their weight (own error path, own preconditions, real logic). Rule of thumb: if the helper body is shorter than its signature plus type declaration, don't extract. Thin steps stay inline with section comments.
- Minimum diff that reuses an existing established pattern beats a new shared abstraction. Before writing something new, search how the same concern is solved elsewhere in the repo and copy that mechanism.
- Things that change together stay together. Place modules next to their real consumers; promote to a shared package only when a second package genuinely needs it.
- Respect a package's existing organizational convention; don't create hybrid layouts.
- When narrowly-scoped feedback arrives ("this comment is too verbose"), do exactly that one thing. Don't expand it into a refactor.

### Architecture patterns

- Server: never call the database from a route handler. DB access lives in repository modules; the handler stays thin (parse, validate, orchestrate, respond).
- Services that fail for business reasons return a typed discriminated Result (`{ ok: true } | { ok: false; error: { kind, ...context } }`) instead of throwing. The route handler maps `kind` to HTTP status; the frontend localizes on `kind`. Programmer errors still throw.
- React: never use `useQuery`/`useMutation` inline in components; extract them into dedicated custom hooks.
- Endpoint-specific error classes live in the file that throws them; only genuinely shared errors go in a shared `errors.ts`.
- Lean on the framework before writing custom helpers (e.g. Hono built-ins, Zod for all validation including env vars).
- Weigh safeguards against real volume. Don't propose "at scale" machinery (idempotency queues, aggressive rate limiting) for low-volume projects where manual remediation is fine.

### Formatting

- Object literals with 2+ fields span multiple lines, one field per line. Single-field objects can stay inline.
- Export constants as individual flat `export const` values, not bundled into a grouping object. The filename already expresses the grouping.
- Write static literals directly with a clarifying comment (`1000n // $10`) instead of factory wrappers for values that never change.

### Comments

- Comments are terse one-liners stating only the non-obvious constraint the code can't show. Extended rationale, mechanisms, and debugging history go in the PR description. This covers inline comments, JSDoc, and comments above test cases.
- No reassurance comments ("X is already validated upstream, so this is safe"). If a reviewer flags a non-issue, push back on the PR; don't appease with a comment.
- No PRD sections, FR numbers, or ticket IDs in code comments or test descriptions. They rot; describe the behavior instead. Ticket refs in commits and PR descriptions are fine.
- Don't restate constant values in comments far from the declaration (they drift). Inline `// $10` next to the literal is fine; use semantic labels elsewhere.
- When a hardcoded value comes from external research (vendor docs, contracts, regulations), put the source URL in a comment next to the value and in the PR description, and verify the link resolves.

### Tests

- No mocks. Use real dependencies (real database, real KV, etc.); only unavoidable third-party APIs get test doubles.
- Don't write tests that assert constant values; downstream behavior tests already cover them.
- Don't write schema-only tests ("parses valid X, rejects invalid Y"); that tests Zod, not our code. If a schema has non-trivial logic, test the consumer's behavior.

### Prose

- Never use em dashes in any prose written for Luis: responses, commit messages, PR descriptions, docs, comments. Use commas, parentheses, colons, or separate sentences. Don't substitute en dashes either.

## This repo specifically

- **Minimal solution first.** Write the smallest working version of a feature. No abstractions for features that don't exist yet, no build tooling unless it becomes necessary. Refactor only when a new feature actually demands it.
- **Minimal tooling.** Default to the most boring, most widely-known tool. No extra package managers, task runners, or config layers unless a concrete problem forces it.
- **Native ESM only, no CommonJS.** Hand-written `require()` is a code smell. Everything compiles to native ESM (`"type": "module"`, tsconfig `module: nodenext`); write `import` with explicit `.js` extensions. The single sanctioned exception is `src/preload.cts` (Electron's sandbox requires a CommonJS preload; tsc emits it as `.cjs`). Prefer removing the cause of a wart over documenting the wart.
- **No hand-written `.d.ts` files.** Shared types live in ordinary `.ts` modules (e.g. `api.ts`) using `export type` / `import type`, so every name has a greppable import stating where it comes from. Reserve `declare global` for names that genuinely exist on the runtime global scope (`window.terminal`, `window.editor`, xterm's classic-script globals), placed next to their creator/consumer. Empty emitted `dist/*.js` for types-only modules is acceptable.
