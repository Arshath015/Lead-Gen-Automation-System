import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  apolloApiKey: required("APOLLO_API_KEY"),
  groqApiKey: required("GROQ_API_KEY"),
  groqModel: process.env.GROQ_MODEL ?? "openai/gpt-oss-20b",
  tavilyApiKey: required("TAVILY_API_KEY"),
  resendApiKey: required("RESEND_API_KEY"),
  emailFrom: required("EMAIL_FROM"),
  // Optional: reply/bounce/complaint webhook isn't set up yet, so these must
  // not block server startup like the required keys above. The webhook route
  // itself returns a clear error if hit while resendWebhookSecret is unset.
  resendWebhookSecret: process.env.RESEND_WEBHOOK_SECRET || null,
  // Address replies should route to. Only meaningful once a receiving domain
  // is configured in Resend; without it, replies just go to EMAIL_FROM.
  resendReplyTo: process.env.RESEND_REPLY_TO || null,
};
