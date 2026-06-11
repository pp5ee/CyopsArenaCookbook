---
name: brainstorming (embedded copy)
source: https://github.com/obra/superpowers/blob/main/skills/brainstorming/SKILL.md
---

# Brainstorming — embedded condensed copy

Used as the offline fallback when `brainstorming-skill.md` cannot be
read at runtime. This is a deliberately shorter paraphrase of the
upstream skill so the file is small enough to ship in the repo.

## What it does

Help turn rough ideas into fully formed designs and specs through
natural collaborative dialogue — one question at a time, leading the
user from intent to a design they sign off on.

## Checklist

1. Explore project context.
2. Ask clarifying questions ONE AT A TIME. Prefer multiple-choice.
3. Propose 2-3 approaches with trade-offs; lead with your recommendation.
4. Present the design in sections; get user approval after each.
5. Write the design to a spec file.
6. Spec self-review: scan for placeholders, contradictions, ambiguity, scope.
7. User reviews the written spec; revise if requested.
8. Transition to writing-plans (NOT to implementation).

## Key principles

- One question at a time.
- Multiple choice > open-ended when possible.
- YAGNI ruthlessly.
- Always present 2-3 alternatives before settling.
- Incremental validation: present, approve, advance.
- Be ready to go back and re-clarify.

## Anti-pattern

"This is too simple to need a design" is the most common failure mode.
Every project goes through this flow, even a single-function utility.
The design can be short (a few sentences), but you MUST present it
and get explicit user approval before any implementation work.
