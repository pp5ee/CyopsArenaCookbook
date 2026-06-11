// HTTP route for the credit pool.
//
//   GET /api/credits → { balance, perVote, perChat, blocked }
//
// The pool is a single global row mutated by the credits service; the
// route is a thin read-only projection so the UI can render the
// "remaining credits" badge without having to parse SSE.

import { Router } from "express";
import { getBalance } from "../services/credits.js";

export const creditsRouter = Router();

creditsRouter.get("/", (_req, res) => {
  res.json(getBalance());
});
