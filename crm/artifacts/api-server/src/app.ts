import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import { authMiddleware } from "./middlewares/authMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// ── Trust Replit's reverse proxy ──────────────────────────────────────────────
// The deployment runs behind Replit's proxy which sets X-Forwarded-For.
// Without this, express-rate-limit throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
// on every request and cannot identify clients correctly.
app.set("trust proxy", 1);

// ── Security headers (Helmet) ─────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }),
);

// ── CORS — allow only Replit / configured domains ────────────────────────────
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/.*\.replit\.dev$/,
  /^https:\/\/.*\.repl\.co$/,
  /^https:\/\/.*\.replit\.app$/,
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
];

// Add your real production domain(s) here once this is deployed somewhere
// other than Replit/localhost.
export const PRODUCTION_ORIGINS = new Set<string>([]);

export function isAllowedOrigin(origin: string): boolean {
  if (PRODUCTION_ORIGINS.has(origin)) return true;
  const extraDomains = (process.env.REPLIT_DOMAINS ?? "").split(",").map(d => d.trim()).filter(Boolean);
  if (extraDomains.some(d => origin === `https://${d}`)) return true;
  return ALLOWED_ORIGIN_PATTERNS.some(p => p.test(origin));
}

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (isAllowedOrigin(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
  }),
);

// ── Request logging ───────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ── Global rate limit (500 req / 15 min per IP) ───────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
  skip: (req) => req.method === "OPTIONS",
});
app.use(globalLimiter);

// ── CSRF protection (custom-header pattern) ──────────────────────────────────
// State-changing requests from a browser must include X-CSRF-Protection: 1 or
// X-Requested-With: XMLHttpRequest. Cross-origin pages cannot set custom
// headers without a successful CORS preflight, which we deny above.
const CSRF_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_SKIP_PREFIXES = ["/api/public/", "/api/health"];

app.use((req: Request, res: Response, next: NextFunction) => {
  if (CSRF_SAFE_METHODS.has(req.method)) return next();
  if (CSRF_SKIP_PREFIXES.some(p => req.path.startsWith(p))) return next();
  const hasProtection =
    req.headers["x-csrf-protection"] === "1" ||
    req.headers["x-requested-with"] === "XMLHttpRequest";
  if (!hasProtection) {
    res.status(403).json({ error: "CSRF check failed" });
    return;
  }
  next();
});

app.use(cookieParser());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(authMiddleware);

app.use("/api", router);

// ── Global error handler — never expose internals ─────────────────────────────
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  (req as unknown as { log: { error: (obj: unknown, msg: string) => void } }).log?.error(
    { err: { message: err.message, name: err.name } },
    "Unhandled error",
  );
  if (res.headersSent) return;
  res.status(500).json({ error: "An unexpected error occurred" });
});

export default app;
