// Centralised env loader. Validated with zod so missing vars fail loudly at boot.
import "dotenv/config";
import { resolve, isAbsolute, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// The `apps/api` package root — used to anchor relative paths so the same
// code works whether the process is launched from the repo root, from
// `apps/api`, or from a built dist folder.
const PKG_ROOT = dirname(fileURLToPath(import.meta.url));
// In dev/tsx this file lives at apps/api/src/config.ts → go up one to package root.
// In dist this file lives at apps/api/dist/config.js → also go up one.
const PACKAGE_ROOT = PKG_ROOT.endsWith("/dist")
  ? PKG_ROOT
  : PKG_ROOT.endsWith("/src")
    ? PKG_ROOT.replace(/\/src$/, "")
    : PKG_ROOT;

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_FILE: z.string().default("data/cookbook.sqlite"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  OPENAI_BASE_URL: z.string().url().default("https://token-ai.cysic.xyz/v1"),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_MODEL: z.string().default(""),

  SUBMISSIONS_URL: z
    .string()
    .url()
    .default("https://arena.cysic.xyz/api/submissions/7YCp4WI_czoa-4MnZ-aBC"),
  VOTE_POLL_MS: z.coerce.number().int().positive().default(60_000),

  CREDIT_START: z.coerce.number().int().nonnegative().default(1000),
  CREDIT_PER_VOTE: z.coerce.number().int().positive().default(100),
  CREDIT_PER_CHAT: z.coerce.number().int().positive().default(20),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("[config] invalid environment:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

// Anchor relative DATABASE_FILE paths to the API package root so the schema
// and the CLI behave the same no matter the cwd. Absolute paths are passed
// through unchanged.
const rawDb = parsed.data.DATABASE_FILE;
const DATABASE_FILE = isAbsolute(rawDb) ? rawDb : resolve(PACKAGE_ROOT, rawDb);

export const config = { ...parsed.data, DATABASE_FILE };
export type AppConfig = typeof config;
