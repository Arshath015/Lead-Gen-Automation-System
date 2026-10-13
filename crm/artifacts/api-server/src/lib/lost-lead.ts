import { and, desc, eq, inArray } from "drizzle-orm";
import { db, activitiesTable, stagesTable } from "@workspace/db";
import { wsFilter } from "./workspaceScope";
export { isStageTransition, lostActivityMarker } from "./lost-lead-rules";

// New Lost transitions use the stable "Lost" marker. Include the older default
// name so pre-existing stage-change activities can also be read.
const LOST_MARKERS = ["Lost", "Closed Lost"];

export async function getLatestLostAt(leadId: number, workspaceId: number | null): Promise<string | null> {
  const [activity] = await db.select({ createdAt: activitiesTable.createdAt })
    .from(activitiesTable)
    .where(and(
      eq(activitiesTable.leadId, leadId),
      eq(activitiesTable.type, "stage_changed"),
      inArray(activitiesTable.newValue, LOST_MARKERS),
      wsFilter(activitiesTable.workspaceId, workspaceId),
    ))
    .orderBy(desc(activitiesTable.createdAt), desc(activitiesTable.id))
    .limit(1);
  return activity?.createdAt.toISOString() ?? null;
}

export async function getLostStage(stageId: number, workspaceId: number | null) {
  const [stage] = await db.select().from(stagesTable)
    .where(and(eq(stagesTable.id, stageId), eq(stagesTable.type, "lead"), wsFilter(stagesTable.workspaceId, workspaceId)));
  return stage;
}
