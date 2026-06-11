// Vitest setup file. Runs once before any test module is imported.
// Redirects the LLM model cache to a per-process temp file so the
// test suite never collides with the dev / prod cache file at
// apps/api/src/services/llm.selectedModel.txt.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "cookbook-llm-cache-"));
process.env["LLM_MODEL_CACHE_FILE"] = join(dir, "selected-model.txt");
