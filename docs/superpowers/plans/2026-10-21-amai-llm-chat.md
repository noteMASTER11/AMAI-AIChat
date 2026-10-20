# AMAI LLM Chat Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. The user selected inline execution and explicitly waived further approval handoffs on 2026-10-21.

**Goal:** Give local AMAI opponents contextual Russian conversations through Codex App Server.

**Architecture:** Extend the map-context JASS sources with an opt-in event collector and preload mailbox. A Node.js process validates messages, schedules per-bot conversations, and returns display-only replies through a fixed generated JASS wrapper.

**Tech Stack:** Warcraft III 3.0.1 JASS, AMAI 3.7.0 Perl build, Node.js standard libraries, Codex App Server stdio.

**Spec:** `docs/superpowers/specs/2026-10-21-amai-llm-chat-design.md`

## Global Constraints

- Model `gpt-6.1-sol`, effort `low`, no automatic substitution.
- Local matches only; no interruption of the user's active match.
- All project, cache and temporary data under `D:\ChatGPT`.
- No manual edits to generated `Scripts/`, no changes to built-in runtime sources.
- First verify a round trip before claiming game telemetry or enabling LLM output.
- Maximum 180 Unicode characters, overall interval 8s, per-bot interval 20s.
- Queue at most 3, one generation at a time, generation timeout 20s; event TTL 20s, chat TTL 45s.
- Text generation has no shell, browser, file tools or inherited personal MCP servers.

## Review Focus

- Existing active game lacks collector: distinguish logs from actual unit events.
- File replacement while reading: reject partial, oversized and wrong-session messages.
- Cyrillic, quotes, backslashes and Warcraft markup: preserve text without executing it.
- Codex protocol errors or exits: reject pending calls and leave AI gameplay running.
- Old replies after a new match: session and sequence checks reject them.

## Task 1: Transport evidence and build prerequisites

**Files:** `bridge/README-RU.md`, `bridge/test.mjs`, `bridge/protocol.mjs`, `LLMChat.eai`.
**Interfaces:** `parseEvents(text) -> Event[]`; `makeReply(event, bot, text) -> string` generates only a fixed preload function.

- [x] Inspect active match logs and report available evidence; do not attach a debugger or change the running match.
- [x] Write failing Node assertions for Cyrillic and escaping, partial records, wrong session and duplicated sequence.
- [x] Implement bounded mailbox parsing and fixed reply generation; run assertions green.
- [x] Add opt-in JASS collector and a no-LLM loopback mode, compile with pjass and jassparser.
- [ ] Verify an actual in-game round trip in the next available test scenario. If unavailable, label the integration unverified rather than invent evidence.

## Task 2: Codex adapter

**Files:** `bridge/codex.mjs`, `bridge/test.mjs`, `bridge/config.json`.
**Interfaces:** `CodexClient.start()`, `generate(event, persona, history) -> {text, silent}`, `close()`.

- [x] Write failing assertions for JSON-RPC errors, process exit, timeout and bounded structured replies.
- [x] Discover installed schemas and supported tool restrictions; implement the smallest stdio client using installed Codex.
- [x] Verify model/list and low effort, then a real generation with tools disabled.
- [x] Confirm process shutdown rejects pending calls and leaves no owned child processes.

## Task 3: Runtime and game integration

**Files:** `bridge/main.mjs`, `bridge/personas.json`, `bridge/test.mjs`, `Blizzard.eai`, `common.eai`, `bridge/Start.ps1`, `bridge/Install.ps1`.
**Interfaces:** `Scheduler.enqueue(event)`, `Scheduler.tick(now)`; stable versioned event and reply protocol from Task 1.

- [x] Write failing assertions for TTL, queue priorities, one in-flight generation, multiple bot cooldowns and stale-session replies.
- [x] Implement scheduler, per-match context, three Russian personalities, event attribution and loopback/LLM modes.
- [x] Register free chat and hero-death events; guard local opt-in matches and retain Commander behaviour.
- [x] Rebuild generated scripts and validate JASS. Add reversible installation with hashes and file-specific backups; do not replace scripts during an active match.
- [ ] Exercise chat, hero death, duplicate/old replies and model failure in game when possible.

## Task 4: Delivery

**Files:** `bridge/README-RU.md`, `CHANGELOG.md`, execution ledger.

- [x] Run the Node self-check and source/build checks; inspect final diff.
- [x] Record observed integration results and remaining external blockers precisely.
- [x] Commit implementation and give the user launch instructions without further approval requests.
