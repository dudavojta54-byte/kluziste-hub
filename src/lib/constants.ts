import type {
  Tier,
  AppRole,
  ApplicationStatus,
  AttendanceStatus,
  AvailabilityKind,
  BonusReason,
  ContactCategory,
  OccurrenceStatus,
  RewardModel,
} from "./types";

export const TIME_ZONE = "Europe/Prague";
export const APP_NAME = "Kluziště Praha";
export const APP_SUBTITLE = "Instructor Hub";

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Správce",
  coordinator: "Koordinátor",
  instructor: "Instruktor",
};

export const APPLICATION_STATUS: Record<ApplicationStatus, { label: string; tone: Tone }> = {
  pending: { label: "Čeká na schválení", tone: "warning" },
  approved: { label: "Schváleno", tone: "success" },
  rejected: { label: "Zamítnuto", tone: "destructive" },
  waitlisted: { label: "Náhradník", tone: "info" },
  withdrawn: { label: "Odhlášeno", tone: "muted" },
  cancel_requested: { label: "Žádost o zrušení", tone: "warning" },
};

export const OCCURRENCE_STATUS: Record<OccurrenceStatus, { label: string; tone: Tone }> = {
  scheduled: { label: "Naplánováno", tone: "info" },
  cancelled: { label: "Zrušeno", tone: "destructive" },
  completed: { label: "Vykázáno", tone: "success" },
};

export const ATTENDANCE_STATUS: Record<AttendanceStatus, string> = {
  present: "Celá účast",
  partial: "Částečná účast",
  absent: "Nepřítomen",
};

export const AVAILABILITY_KIND: Record<AvailabilityKind, { label: string; tone: Tone }> = {
  available: { label: "Mohu pracovat", tone: "success" },
  preferred: { label: "Preferuji práci", tone: "info" },
  unavailable: { label: "Nemohu pracovat", tone: "destructive" },
};

export const REWARD_MODEL: Record<RewardModel, { label: string; description: string }> = {
  program: { label: "Podle sazeb programů", description: "Odučené hodiny × sazba programu (výchozí pro všechny)" },
  hourly: { label: "Vlastní hodinová sazba", description: "Všechny hodiny × individuální sazba (výjimka)" },
  fixed: { label: "Fixní měsíční částka", description: "Smluvená částka nezávislá na hodinách (výjimka)" },
  credit: { label: "Kreditová (původní)", description: "Kredity × cena kreditu – jen pro starší dohody" },
};

export const BONUS_REASON: Record<BonusReason, string> = {
  quality: "Kvalitně odvedená práce",
  last_minute: "Záskok na poslední chvíli",
  new_program: "Vytvoření nového programu",
  training: "Zaškolení instruktora",
  initiative: "Mimořádná iniciativa",
  other: "Jiný důvod",
};

export const CONTACT_CATEGORY: Record<ContactCategory, string> = {
  program_manager: "Manažer programu",
  coordinator: "Koordinátor",
  rink_manager: "Vedoucí kluziště",
  tech_support: "Technická podpora",
  emergency: "Mimořádné situace",
  other: "Ostatní",
};

export const WEEKDAYS = ["Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek", "Sobota", "Neděle"];
export const WEEKDAYS_SHORT = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];

export type Tone = "success" | "warning" | "destructive" | "info" | "muted";

export const TONE_CLASSES: Record<Tone, string> = {
  success: "bg-success/12 text-success border-success/25",
  warning: "bg-warning/15 text-[color-mix(in_oklch,var(--warning),black_35%)] dark:text-warning border-warning/30",
  destructive: "bg-destructive/10 text-destructive border-destructive/25",
  info: "bg-primary/10 text-primary border-primary/25",
  muted: "bg-muted text-muted-foreground border-border",
};

export const TIER: Record<Tier, { label: string; description: string; tone: Tone }> = {
  main: { label: "Hlavní", description: "Prověření instruktoři, přednost při přidělování práce", tone: "success" },
  development: { label: "Rozvojový", description: "Postupné zapracování a možnost většího zapojení", tone: "info" },
  flexible: { label: "Flexibilní", description: "Posily na eventy, špičky a záskoky", tone: "muted" },
};
export const TIER_ORDER: Record<Tier, number> = { main: 0, development: 1, flexible: 2 };

/** Týdenní rytmus plánování */
export const AVAILABILITY_DEADLINE_WEEKDAY = 3; // středa
