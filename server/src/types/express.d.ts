// Augments Express's Request with the raw request body, captured by
// express.json()'s verify hook in index.ts. Webhook signature verification
// (Resend/Svix) needs the exact original bytes, which JSON.stringify(req.body)
// cannot reliably reproduce (key order, whitespace).
import "express";

declare module "express-serve-static-core" {
  interface Request {
    rawBody?: string;
  }
}
