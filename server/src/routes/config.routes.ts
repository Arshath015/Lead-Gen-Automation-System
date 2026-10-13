import { Router } from "express";
import { env } from "../config/env";

export const configRouter = Router();

// Exposes only non-secret, already-public-facing config (the sender address
// recipients see in every sent email's From header) so the frontend can show
// a real "from" identity in the email composer without touching API keys.
configRouter.get("/", (_req, res) => {
  res.json({ emailFrom: env.emailFrom });
});
