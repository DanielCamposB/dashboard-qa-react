// Modelo de datos compartido (web + API). Es el mismo documento JSON que el dashboard original guardaba en `app_state`.

export type Status = "Pendiente" | "En curso" | "Bloqueado" | "Completado";
export type Priority = "" | "Urgente" | "Importante" | "Media" | "Baja";
export type DeliverableState = "pendiente" | "entregado" | "validado";
export type DurationUnit = "d" | "hh";

export interface Activity {
  id: string;
  name: string;
  start: string; // aaaa-mm-dd
  end: string;
  percent: number;
  assigneeId?: string; // primer responsable (compatibilidad con datos antiguos)
  assigneeIds?: string[];
  blocked: boolean;
  blockReason?: string;
  blockedSince?: string;
}

export interface Deliverable {
  id: string;
  name: string;
  due: string;
  state: DeliverableState;
  url: string;
  deliveredAt?: string;
}

export interface Comment {
  id: string;
  at: string; // ISO
  by: string;
  byEmail?: string;
  text: string;
  src?: "planner";
  edits?: { text: string; at: string; by: string }[];
  editedAt?: string;
}

export interface DateLogEntry {
  at: string;
  by: string;
  from: string;
  to: string;
  reason: string;
}

export type MetricKey = "designed" | "executed" | "passed" | "failed" | "automated" | "crit" | "high" | "med" | "low";
export type Metrics = Partial<Record<MetricKey, number | "">> & { wiId?: string; wiUrl?: string };

export interface PlannerSnap {
  title?: string;
  status?: Status;
  start?: string;
  end?: string;
  priority?: string;
  bucket?: string;
  labels?: string;
  who?: string;
}

export interface Requirement {
  id: string;
  clientId: string;
  code: string;
  title: string;
  type: string; // "trad" | "express" | id de plantilla personalizada
  assigneeId?: string;
  assigneeIds?: string[];
  leaderIds: string[];
  status: Status;
  percent: number;
  start: string;
  end: string;
  priority: Priority | string;
  bucket: string;
  acts: Activity[];
  deliverables: Deliverable[];
  metrics: Metrics;
  comments: Comment[];
  dateLog: DateLogEntry[];
  committedEnd: string;
  lastUpdate: string;
  completedAt?: string;
  src?: { planner: true; taskId: string; planId: string; labels: string[]; checks: string[]; syncedAt: string; snap: PlannerSnap };
}

export interface TeamsEvents {
  sync?: boolean;
  blocked?: boolean;
  auto?: boolean;
  all?: boolean;
  byOwner?: boolean;
  quiet?: boolean;
  owners?: boolean;
}

export interface Client {
  id: string;
  name: string;
  planner: { enabled: boolean; planId: string; planName: string; lastSync: string };
  teams: { enabled: boolean; webhook: string; hasUrl?: boolean; events: TeamsEvents };
}

export interface Member {
  id: string;
  name: string;
  email: string;
  roles: string[];
}
export type Leader = Member;

export interface TemplateAct {
  name: string;
  days: number;
  unit?: DurationUnit;
}
export interface CustomTemplate {
  id: string;
  name: string;
  acts: TemplateAct[];
}

export interface Notify {
  times: string[];
  days: number[]; // 1 = lunes … 7 = domingo
  auto?: boolean;
  userWebhook: string;
  hasUserUrl?: boolean;
  siteUrl: string;
}

export interface Store {
  clients: Client[];
  members: Member[];
  leaders: Leader[];
  roles: string[];
  leaderRoles: string[];
  templates: { trad: TemplateAct[]; express: TemplateAct[] };
  customTpl: CustomTemplate[];
  reqs: Requirement[];
  notify: Notify;
}

export type Role = "admin" | "editor" | "viewer" | "pending";

export interface Profile {
  email: string;
  role: Role;
  nombres?: string | null;
  apellido_paterno?: string | null;
  apellido_materno?: string | null;
  cargo?: string | null;
  vertical?: string | null;
  cumpleanos?: string | null;
  telefono?: string | null;
  locked?: boolean;
  locked_at?: string | null;
  fails?: number;
}

/** Operación pequeña que se puede volver a aplicar sobre la última versión si otra persona guardó antes. */
export type Op = (s: Store) => void;
