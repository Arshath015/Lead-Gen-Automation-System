import { describe, expect, it } from "vitest";
import {
  buildWebToLeadLeadValues,
  createWebToLeadToken,
  hashWebToLeadToken,
  isWebToLeadTokenFormatValid,
  selectInitialLeadStage,
} from "./web-to-lead";
import type { Stage } from "@workspace/db";

describe("secure web-to-lead routing", () => {
  it("issues high-entropy tokens and accepts only the matching token hash", () => {
    const token = createWebToLeadToken();
    const persistedHash = hashWebToLeadToken(token);

    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(isWebToLeadTokenFormatValid(token)).toBe(true);
    expect(hashWebToLeadToken(token)).toBe(persistedHash);
    expect(hashWebToLeadToken(`${token.slice(0, -1)}0`)).not.toBe(persistedHash);
    expect(isWebToLeadTokenFormatValid(undefined)).toBe(false);
    expect(isWebToLeadTokenFormatValid("short-token")).toBe(false);
  });

  it("chooses only the current workspace's default lead stage", () => {
    const stage = (id: number, workspaceId: number, type: string, isDefault: boolean) => ({
      id, workspaceId, type, isDefault, order: 0,
    }) as Stage;
    const selected = selectInitialLeadStage([
      stage(10, 1, "lead", true),
      stage(20, 2, "lead", true),
      stage(30, 1, "deal", true),
      stage(40, 1, "lead", false),
    ], 2);

    expect(selected?.id).toBe(20);
    expect(selectInitialLeadStage([stage(10, 1, "lead", true)], 2)).toBeUndefined();
  });

  it("builds lead data with the resolved workspace and default stage", () => {
    const values = buildWebToLeadLeadValues({
      companyName: " Acme ",
      contactPerson: " Jane Doe ",
      email: " jane@example.com ",
    }, 42, 20);

    expect(values).toMatchObject({
      companyName: "Acme",
      contactPerson: "Jane Doe",
      email: "jane@example.com",
      source: "web_form",
      workspaceId: 42,
      stageId: 20,
    });
  });
});