# Project agent skills

Two vendored skills, committed so every session in this checkout gets the same ones.

| Skill | Invocation | Use for |
| --- | --- | --- |
| `diagnosing-bugs` | automatic, or `/diagnosing-bugs` | a bug or regression with **no deterministic repro yet** |
| `grilling` | `/grilling` only | resolving a design before a change that could move replay hashes or need a `HAB_VERSION` bump |

Everything else stays as it was: review is the built-in `/code-review`, quality cleanups are `/simplify`,
exploration is the `Explore` agent. Neither skill runs a review pass.

## Provenance

Copied from [mattpocock/skills](https://github.com/mattpocock/skills) at commit
`5863806dd4e15c63174bee4e7515a4256792ecfa` (2026-11-12), `skills/engineering/diagnosing-bugs` and
`skills/productivity/grilling`. The upstream repo's other 25+ skills are deliberately not installed, and the
plugin (`mattpocock-skills@claude-plugins-official`) is deliberately not used: it ships all of them as one unit,
including a `code-review` that would shadow the built-in one.

Local changes, kept small so an upstream diff stays readable:

- `grilling`: `disable-model-invocation: true`, so it costs nothing per turn and only fires when typed.
- `diagnosing-bugs`: the upstream `GLOSSARY.md` / ADR pointer replaced with this repo's per-subsystem docs;
  a table of this repo's existing deterministic loops added to Phase 1; `npm run check`, `scripts/checksum.ts`
  and doc-update items added to the Phase 6 cleanup list.

To take upstream fixes, diff against that commit:

```bash
git clone --depth 1 https://github.com/mattpocock/skills /tmp/mp-skills-src
diff -ru /tmp/mp-skills-src/skills/engineering/diagnosing-bugs .claude/skills/diagnosing-bugs
diff -ru /tmp/mp-skills-src/skills/productivity/grilling      .claude/skills/grilling
```

## Licence

Both skills are MIT-licensed by their author. The notice travels with the copies:

```
MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
