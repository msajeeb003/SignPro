---
name: signpro-design
description: Use this skill to generate well-branded interfaces and assets for SignPro, the electronic-signature platform for legally binding documents (NDAs, contracts). Either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the `README.md` file within this skill, and explore the other available files (`colors_and_type.css`, `ui_kits/webapp/`, `preview/`, `assets/`).

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. Always `@import './colors_and_type.css'` rather than re-declaring tokens. The UI kit at `ui_kits/webapp/` is the source of truth for component visuals — copy its JSX patterns when building new SignPro screens.

If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand. The original codebase is at https://github.com/msajeeb003/SignPro — refer to `frontend/src/styles.css` for the canonical CSS.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Core constraints to honor

- **No emoji, no gradients, no decorative imagery.** SignPro is for legal documents.
- **Sentence case** for everything except UPPERCASE status pills and table headers.
- **One primary blue** (`#2563eb`), three semantic colors, three text greys. No new colors.
- **Type stack:** Geist + Geist Mono (substitute for native system-ui in mocks).
- **6px radius default, 1px borders, no shadows on regular cards.**
- **Icons:** Lucide via CDN if needed — flag the substitution.
