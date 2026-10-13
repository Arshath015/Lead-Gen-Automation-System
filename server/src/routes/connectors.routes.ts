import { Router } from "express";
import { listSourceNames, getSourceAdapter } from "../sources/registry";

export interface ConnectorStatusDto {
  name: string;
  capabilities: string[];
  configured: boolean;
}

// Derives the public connector-status list straight from the registry.
// Deliberately picks exactly these three fields — name, capabilities,
// configured — rather than spreading the adapter: an ISourceAdapter has no
// credential fields on it today, but this keeps that guarantee explicit
// regardless of what a future connector's adapter object happens to hold.
export function getConnectorStatuses(): ConnectorStatusDto[] {
  return listSourceNames().map((name) => {
    const adapter = getSourceAdapter(name)!; // name came from this same registry, so this is always found
    return {
      name: adapter.name,
      capabilities: [...adapter.capabilities],
      configured: adapter.isConfigured(),
    };
  });
}

export const connectorsRouter = Router();

connectorsRouter.get("/", (_req, res) => {
  res.json(getConnectorStatuses());
});
