import { readCollection, withCollectionLock, writeCollection } from "./jsonStore";
import { DEFAULT_AUTOMATION_SETTINGS, type EmailAutomationSettings } from "../types/automation";

const COLLECTION = "automationSettings";

// Settings written before emailSignature existed won't have it in the stored
// JSON. Default it on read rather than requiring a migration.
function normalize(settings: EmailAutomationSettings): EmailAutomationSettings {
  return { ...settings, emailSignature: settings.emailSignature ?? "" };
}

// Singleton settings stored as the one element of an otherwise-array
// collection, matching the existing jsonStore convention rather than adding
// a separate key-value storage mechanism for a single record.
export const automationSettingsRepository = {
  async get(): Promise<EmailAutomationSettings> {
    const all = await readCollection<EmailAutomationSettings>(COLLECTION);
    return normalize(all[0] ?? DEFAULT_AUTOMATION_SETTINGS);
  },

  async update(data: Partial<EmailAutomationSettings>): Promise<EmailAutomationSettings> {
    return withCollectionLock(COLLECTION, async () => {
      const all = await readCollection<EmailAutomationSettings>(COLLECTION);
      const current = normalize(all[0] ?? DEFAULT_AUTOMATION_SETTINGS);
      const updated: EmailAutomationSettings = {
        ...current,
        ...data,
        updatedAt: new Date().toISOString(),
      };
      await writeCollection(COLLECTION, [updated]);
      return updated;
    });
  },
};
