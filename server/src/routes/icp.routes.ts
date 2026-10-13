import { Router } from "express";
import { icpRepository } from "../db/icpRepository";

export const icpRouter = Router();

icpRouter.get("/", async (_req, res) => {
  const profiles = await icpRepository.list();
  res.json(profiles);
});

icpRouter.get("/:id", async (req, res) => {
  const profile = await icpRepository.getById(req.params.id);
  if (!profile) return res.status(404).json({ error: "Not found" });
  res.json(profile);
});

icpRouter.post("/", async (req, res) => {
  const { name, filters } = req.body ?? {};
  if (!name || !filters) {
    return res.status(400).json({ error: "name and filters are required" });
  }
  const profile = await icpRepository.create({ name, filters });
  res.status(201).json(profile);
});

icpRouter.put("/:id", async (req, res) => {
  const updated = await icpRepository.update(req.params.id, req.body ?? {});
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

icpRouter.delete("/:id", async (req, res) => {
  const ok = await icpRepository.delete(req.params.id);
  if (!ok) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
});
