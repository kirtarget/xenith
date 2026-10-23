# Documentation updates

- Update the primary English `README.md` in the same task whenever making project changes or adding features.
- Keep `README.ru.md` synchronized for changes that affect users.
- Document changed behavior, controls, setup steps, and limitations. Remove outdated instructions.
- Update the matching screenshots when a documented interface changes.
- Distinguish automated checks from verification on real hardware. Do not describe untested hardware behavior as verified.
- Documentation updates are part of completion, not a separate follow-up task.

# Agent instructions

- Keep `AGENTS.md` and `CLAUDE.md` byte-for-byte identical. Update both in the same change.
- Run `node tools/check-agent-docs.mjs` after changing either file.
