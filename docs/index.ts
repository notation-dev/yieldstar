import type { DocCategory } from "@notation/docs/config";
import { manual } from "./manual/nav";
import { runtimes } from "./runtimes/nav";
import { packages } from "./packages/nav";

// Each category declares its own nav in a `nav.ts` beside its Markdown. This
// file only fixes the order they appear in, which must match the `categories`
// option in vite.config.ts.
export const categories: DocCategory[] = [manual, runtimes, packages];
