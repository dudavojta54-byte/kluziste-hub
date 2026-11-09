export type AppRole = "admin" | "coordinator" | "instructor";
export type RegistrationStatus = "open" | "closed";
export type OccurrenceStatus = "scheduled" | "cancelled" | "completed";
export type ApplicationStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "waitlisted"
  | "withdrawn"
  | "cancel_requested";
export type AvailabilityKind = "available" | "unavailable" | "preferred";
export type AttendanceStatus = "present" | "partial" | "absent";
export type RewardModel = "credit" | "hourly" | "fixed";
export type BonusReason = "quality" | "last_minute" | "new_program" | "training" | "initiative" | "other";
export type ContactCategory =
  | "program_manager"
  | "coordinator"
  | "rink_manager"
  | "tech_support"
  | "emergency"
  | "other";

export interface Profile {
  id: string;
  first_name: string;
  last_name: string;
  title: string | null;
  avatar_url: string | null;
  team_phone: string | null;
  team_email: string | null;
  specializations: string[];
  preferred_location_id: string | null;
  bio: string | null;
  notify_email: boolean;
  is_active: boolean;
  created_at: string;
}

export interface ProfilePrivate {
  user_id: string;
  personal_phone: string | null;
  address: string | null;
  bank_account: string | null;
  birth_date: string | null;
  emergency_contact: string | null;
  admin_note: string | null;
}

export interface Location {
  id: string;
  name: string;
  address: string | null;
  color: string;
  is_active: boolean;
}

export interface LessonType {
  id: string;
  code: string;
  name: string;
  credit_multiplier: number | null;
  color: string;
  sort_order: number;
  is_active: boolean;
}

export interface Occurrence {
  id: string;
  lesson_id: string;
  title: string;
  lesson_type_id: string;
  location_id: string;
  starts_at: string;
  ends_at: string;
  required_instructors: number;
  credit_multiplier: number;
  description: string | null;
  instructions: string | null;
  registration_status: RegistrationStatus;
  registration_deadline: string | null;
  status: OccurrenceStatus;
  cancel_reason: string | null;
}

export interface Assignment {
  id: string;
  occurrence_id: string;
  user_id: string;
  application_id: string | null;
  status: "active" | "cancelled";
}

export interface Application {
  id: string;
  occurrence_id: string;
  user_id: string;
  status: ApplicationStatus;
  note: string | null;
  decision_note: string | null;
  created_at: string;
}

/** Termín se vztahy, jak ho vrací dotaz v useOccurrences */
export interface OccurrenceFull extends Occurrence {
  lesson_type: Pick<LessonType, "id" | "code" | "name" | "color">;
  location: Pick<Location, "id" | "name" | "color">;
  assignments: Pick<Assignment, "id" | "user_id" | "status">[];
}

export interface Availability {
  id: string;
  user_id: string;
  date: string | null;
  weekday: number | null;
  start_time: string | null;
  end_time: string | null;
  kind: AvailabilityKind;
  note: string | null;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  important: boolean;
  audience: "all" | "selected";
  created_by: string;
  created_at: string;
}

export interface Contact {
  id: string;
  category: ContactCategory;
  name: string;
  role_label: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface DocumentRow {
  id: string;
  title: string;
  category: string;
  body: string | null;
  url: string | null;
  storage_path: string | null;
  pinned: boolean;
  created_at: string;
}

export interface RewardSettings {
  id: string;
  user_id: string;
  model: RewardModel;
  credit_rate: number;
  hourly_rate: number;
  fixed_amount: number;
  monthly_credit_target: number | null;
  valid_from: string;
  note: string | null;
}

export interface StatementItem {
  id: string;
  occurrence_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  lesson_type: string;
  location: string;
  status: AttendanceStatus;
  hours: number;
  credit_multiplier: number;
  credits: number;
}

export interface Statement {
  user_id: string;
  period: string;
  hours: number;
  lessons: number;
  lesson_credits: number;
  bonus_credits: number;
  total_credits: number;
  bonus_amount: number;
  model: RewardModel | null;
  credit_rate: number | null;
  hourly_rate: number | null;
  fixed_amount: number | null;
  monthly_credit_target: number | null;
  base_amount: number;
  total_amount: number;
  closed: boolean;
  by_type: { lesson_type_id: string; name: string; color: string; hours: number; credits: number; lessons: number }[];
  items: StatementItem[];
  bonuses: { id: string; reason: BonusReason; reason_text: string; awarded_on: string; credits: number; amount: number }[];
}

export interface TeamOverviewRow {
  user_id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  is_active: boolean;
  hours: number;
  lessons: number;
  lesson_credits: number;
  bonus_credits: number;
  confirmed_lessons: number;
  reward: number | null;
  model: RewardModel | null;
}

export interface DashboardOccurrence extends Occurrence {
  type_name: string;
  type_color: string;
  location_name: string;
  assigned: number;
  pending: number;
}

export interface AdminDashboard {
  day: string;
  period: string;
  today: DashboardOccurrence[];
  understaffed: DashboardOccurrence[];
  upcoming: DashboardOccurrence[];
  active_instructors: number;
  pending_applications: number;
  month_hours: number;
  month_credits: number;
  estimated_cost: number | null;
  unconfirmed: Pick<Occurrence, "id" | "title" | "starts_at" | "ends_at">[];
  conflicts: {
    kind: "unavailable" | "overlap" | "cancel_request";
    occurrence_id: string;
    title: string;
    starts_at: string;
    user_id: string;
    user_name: string;
  }[];
}

export interface Suggestion {
  user_id: string;
  name: string;
  avatar_url: string | null;
  specialization_match: boolean;
  preferred_location: boolean;
  has_conflict: boolean;
  availability: AvailabilityKind | null;
  application_status: ApplicationStatus | null;
  month_hours: number;
  score: number;
}

export interface SessionUser {
  id: string;
  email: string;
  profile: Profile;
  roles: AppRole[];
}
