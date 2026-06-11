// Centralised env loader. Validated with zod so missing vars fail loudly at boot.
import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_FILE: z.string().default("apps/api/data/cookbook.sqlite"),
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

export const config = parsed.data;
export type AppConfig = typeof config;
