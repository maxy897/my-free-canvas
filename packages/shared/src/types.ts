// --- Canvas Types ---
export * from "./canvas-types";
export * from "./dag-executor";
export * from "./dag-solver";
export * from "./task-output";

// --- Credits & Subscriptions ---

export type SubscriptionTier = "free" | "pro" | "premium";
export type SubscriptionStatus = "active" | "cancelled" | "paused";

export interface Subscription {
  id: string;
  userId: string;
  tier: SubscriptionTier;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  status: SubscriptionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface UserCredits {
  id: string;
  userId: string;
  balance: number;
  free_balance: number;
  purchased_balance: number;
  createdAt: string;
  updatedAt: string;
}

export type CreditTransactionType = "purchase" | "use" | "refund" | "bonus" | "subscription_daily" | "redeem";

export interface CreditTransaction {
  id: string;
  userId: string;
  amount: number;
  type: CreditTransactionType;
  relatedTaskId: string | null;
  description: string;
  createdAt: string;
}

// --- Prompt Templates ---

export interface PromptTemplate {
  id: string;
  title: string;
  content: string;
  category: string | null;
  tags: string[];
  coverUrl: string | null;
  /** Whether this template is designed to be used with an uploaded reference image (img2img). */
  needsReference: boolean;
  sortOrder: number;
  createdAt: string;
}

// --- Announcements ---

export type AnnouncementLevel = "info" | "success" | "warning" | "critical";

export interface Announcement {
  id: string;
  title: string;
  content: string;
  level: AnnouncementLevel;
  isActive: boolean;
  isDismissible: boolean;
  /** Optional ISO 8601 UTC display window. `null` means no bound. */
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- API Responses ---

export interface CreditsResponse {
  dailyCredits: number;
  dailyLimit: number;
  purchasedCredits: number;
  freeCredits: number;
  totalAvailable: number;
  subscription: Subscription | null;
}

export interface QuotaResponse {
  used: number;
  limit: number;
  resetsAt: string;
}

// --- Constants (customize per project) ---

export const WELCOME_BONUS = 10000;

export const DAILY_CREDITS = {
  free: 0,
  pro: 30,
  premium: 100,
} as const;

export const PRICING = {
  testPack: { credits: 5, price: 0.99, description: "Test Pack · 5 Credits" },
  starterPack: { credits: 200, price: 9.90, description: "Starter Pack · 200 Credits" },
  standardPack: { credits: 550, price: 19.90, description: "Standard Pack · 550 Credits" },
  proPack: { credits: 1450, price: 49.90, description: "Pro Pack · 1,450 Credits" },
} as const;

export const SUBSCRIPTION_PRICING = {
  monthly: {
    pro: 9.99,
    premium: 29.99,
  },
  yearly: {
    pro: 79.99,
    premium: 239.99,
  },
} as const;
