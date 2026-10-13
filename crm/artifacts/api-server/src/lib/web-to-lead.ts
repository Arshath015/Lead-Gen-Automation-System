import crypto from "crypto";
import type { Stage } from "@workspace/db";

export type WebToLeadFields = {
  companyName?: unknown;
  contactPerson?: unknown;
  email?: unknown;
  phone?: unknown;
  location?: unknown;
  industry?: unknown;
  message?: unknown;
};

function optionalTrim(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null;
}

export function createWebToLeadToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashWebToLeadToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function isWebToLeadTokenFormatValid(token: unknown): token is string {
  return typeof token === "string" && /^[a-f0-9]{64}$/i.test(token);
}

export function selectInitialLeadStage(stages: Stage[], workspaceId: number): Stage | undefined {
  return stages
    .filter(stage => stage.workspaceId === workspaceId && stage.type === "lead" && stage.isDefault)
    .sort((a, b) => a.order - b.order)[0];
}

export function buildWebToLeadLeadValues(
  fields: WebToLeadFields,
  workspaceId: number,
  stageId: number,
) {
  const companyName = optionalTrim(fields.companyName);
  const contactPerson = optionalTrim(fields.contactPerson);
  return {
    companyName: companyName ?? "",
    contactPerson: contactPerson ?? "",
    email: optionalTrim(fields.email),
    phone: optionalTrim(fields.phone),
    location: optionalTrim(fields.location),
    industry: optionalTrim(fields.industry),
    remarks: optionalTrim(fields.message),
    source: "web_form" as const,
    stageId,
    ownerId: null,
    createdById: null,
    workspaceId,
  };
}