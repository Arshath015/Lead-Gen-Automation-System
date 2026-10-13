/**
 * PERMISSION_MATRIX — canonical source of truth for all modules and their valid actions.
 * Used by the server for seeding, validation, and middleware.
 * Exported from @workspace/db for shared use.
 */
export const PERMISSION_MATRIX = {
  leads:           ["view", "create", "edit", "delete", "assign", "import", "export"],
  pipeline:        ["view", "edit", "move_stage", "assign"],
  contacts:        ["view", "create", "edit", "delete", "import", "export"],
  deals:           ["view", "create", "edit", "delete"],
  tasks:           ["view", "create", "edit", "delete", "assign"],
  activities:      ["view", "create", "edit", "delete"],
  followups:       ["view", "create", "edit", "delete"],
  reports:         ["view", "export"],
  dashboard:       ["view", "customize"],
  users:           ["view", "create", "edit", "disable", "delete", "force_logout", "unlock_account"],
  roles:           ["view", "create", "edit", "delete"],
  settings:        ["view", "edit"],
  smtp:            ["view", "edit"],
  whatsapp:        ["view", "edit"],
  automation:      ["view", "create", "edit", "delete"],
  forms:           ["view", "create", "edit", "delete"],
  files:           ["upload", "download", "delete"],
  notifications:   ["view", "send"],
  email_templates: ["view", "edit"],
  audit:           ["view"],
  billing:         ["view", "manage"],
  integrations:    ["view", "manage"],
  approvals:       ["view", "approve", "reject"],
  revenue_entries: ["manage"],
} as const satisfies Record<string, readonly string[]>;

export type PermissionModule = keyof typeof PERMISSION_MATRIX;
export type Permission = { [K in PermissionModule]: `${K}.${typeof PERMISSION_MATRIX[K][number]}` }[PermissionModule];

/** All permission strings as a flat array: "leads.view", "leads.create", etc. */
export function getAllPermissions(): string[] {
  return Object.entries(PERMISSION_MATRIX).flatMap(([mod, actions]) =>
    actions.map(a => `${mod}.${a}`)
  );
}

/**
 * Default permission set for each system role.
 * Returns an array of { module, action, allowed } objects.
 */
export function getDefaultRolePermissions(roleKey: SystemRoleKey): Array<{ module: string; action: string; allowed: boolean }> {
  const all = getAllPermissions();
  const granted = new Set(ROLE_PERMISSION_GRANTS[roleKey] ?? []);
  return all.map(p => {
    const [module, action] = p.split(".");
    return { module, action, allowed: granted.has(p) };
  });
}

export type SystemRoleKey =
  | "workspace_super_admin"
  | "admin"
  | "manager"
  | "sales"
  | "marketing"
  | "operations"
  | "finance"
  | "support"
  | "custom";

export const SYSTEM_ROLES: Array<{
  key: SystemRoleKey;
  name: string;
  description: string;
  dataScope: "all" | "team" | "own";
  hierarchy: number;
  isDefault: boolean;
}> = [
  { key: "workspace_super_admin", name: "Super Admin",  description: "Full access to all workspace data and settings", dataScope: "all",  hierarchy: 1, isDefault: false },
  { key: "admin",                 name: "Admin",         description: "Full administrative access",                     dataScope: "all",  hierarchy: 2, isDefault: false },
  { key: "manager",               name: "Manager",       description: "Team lead with team-level access",               dataScope: "team", hierarchy: 3, isDefault: false },
  { key: "sales",                 name: "Sales Member",  description: "Standard sales access with own-data scope",     dataScope: "own",  hierarchy: 4, isDefault: true  },
  { key: "marketing",             name: "Marketing",     description: "Marketing team access",                          dataScope: "own",  hierarchy: 5, isDefault: false },
  { key: "operations",            name: "Operations",    description: "Operations and process management",              dataScope: "all",  hierarchy: 6, isDefault: false },
  { key: "finance",               name: "Finance",       description: "Financial reporting and billing",                dataScope: "all",  hierarchy: 7, isDefault: false },
  { key: "support",               name: "Support",       description: "Customer support access",                        dataScope: "own",  hierarchy: 8, isDefault: false },
  { key: "custom",                name: "Custom",        description: "Custom role with no default permissions",        dataScope: "own",  hierarchy: 9, isDefault: false },
];

const ALL = getAllPermissions();

const ROLE_PERMISSION_GRANTS: Record<SystemRoleKey, string[]> = {
  workspace_super_admin: ALL,

  admin: ALL.filter(p => p !== "billing.manage"),

  manager: [
    // Leads
    "leads.view", "leads.create", "leads.edit", "leads.delete", "leads.assign", "leads.export",
    // Pipeline
    "pipeline.view", "pipeline.edit", "pipeline.move_stage", "pipeline.assign",
    // Contacts
    "contacts.view", "contacts.create", "contacts.edit", "contacts.delete", "contacts.export",
    // Deals
    "deals.view", "deals.create", "deals.edit", "deals.delete",
    // Tasks
    "tasks.view", "tasks.create", "tasks.edit", "tasks.delete", "tasks.assign",
    // Activities & Follow-ups
    "activities.view", "activities.create", "activities.edit",
    "followups.view", "followups.create", "followups.edit", "followups.delete",
    // Reports & Dashboard
    "reports.view", "reports.export",
    "dashboard.view",
    // Users (view only)
    "users.view",
    // Notifications & Email
    "notifications.view",
    "email_templates.view",
    // Approvals
    "approvals.view", "approvals.approve", "approvals.reject",
  ],

  sales: [
    "leads.view", "leads.create", "leads.edit",
    "pipeline.view", "pipeline.edit", "pipeline.move_stage",
    "contacts.view", "contacts.create", "contacts.edit",
    "deals.view", "deals.create", "deals.edit",
    "tasks.view", "tasks.create", "tasks.edit", "tasks.assign",
    "activities.view", "activities.create",
    "followups.view", "followups.create", "followups.edit",
    "dashboard.view",
    "notifications.view",
    "approvals.view",
  ],

  marketing: [
    "leads.view", "leads.import", "leads.export",
    "contacts.view", "contacts.import", "contacts.export",
    "email_templates.view", "email_templates.edit",
    "forms.view", "forms.create", "forms.edit", "forms.delete",
    "reports.view",
    "notifications.view", "notifications.send",
    "dashboard.view",
  ],

  operations: [
    "tasks.view", "tasks.create", "tasks.edit", "tasks.delete", "tasks.assign",
    "activities.view", "activities.create", "activities.edit",
    "automation.view", "automation.create", "automation.edit", "automation.delete",
    "settings.view", "settings.edit",
    "smtp.view", "smtp.edit",
    "integrations.view", "integrations.manage",
    "files.upload", "files.download", "files.delete",
    "dashboard.view",
  ],

  finance: [
    // Deals — read-only org-wide view so Finance can navigate to any deal
    "deals.view",
    // pipeline.view is required to fetch the stages list (Kanban column headers).
    // Finance can't manage pipeline stages (those routes require settings.edit),
    // but they need stage names to render the Kanban board at all.
    "pipeline.view",
    // Revenue entries — the only write permission for this role
    "revenue_entries.manage",
  ],

  support: [
    "leads.view", "leads.edit",
    "contacts.view", "contacts.edit",
    "tasks.view", "tasks.create", "tasks.edit",
    "activities.view", "activities.create",
    "followups.view", "followups.create",
    "notifications.view",
    "dashboard.view",
  ],

  custom: [],
};
