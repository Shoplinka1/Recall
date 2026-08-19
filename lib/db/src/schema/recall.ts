import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  integer,
  index,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const usersTable = pgTable("recall_users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  avatarUrl: text("avatar_url"),
  ...timestamps,
});

export const sessionsTable = pgTable(
  "recall_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("recall_sessions_user_id_idx").on(table.userId),
    index("recall_sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const userPreferencesTable = pgTable("recall_user_preferences", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  preferredLanguage: text("preferred_language").notNull().default("en"),
  studyGoal: text("study_goal"),
  dailyStudyGoalMinutes: integer("daily_study_goal_minutes")
    .notNull()
    .default(20),
  preferredQuestionTypes: jsonb("preferred_question_types")
    .$type<string[]>()
    .notNull()
    .default(["multiple_choice"]),
  preferredDifficulty: text("preferred_difficulty").notNull().default("medium"),
  ...timestamps,
});

export const subscriptionsTable = pgTable("recall_subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  provider: text("provider"),
  providerCustomerCode: text("provider_customer_code"),
  providerSubscriptionCode: text("provider_subscription_code"),
  providerPlanCode: text("provider_plan_code"),
  plan: text("plan").notNull().default("free"),
  status: text("status").notNull().default("free"),
  amount: integer("amount"),
  currency: text("currency"),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  ...timestamps,
});

export const subjectsTable = pgTable("recall_subjects", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  color: text("color").notNull().default("violet"),
  ...timestamps,
});

export const materialsTable = pgTable("recall_materials", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  subjectId: uuid("subject_id")
    .notNull()
    .references(() => subjectsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  originalFileName: text("original_file_name"),
  fileType: text("file_type").notNull(),
  fileSize: integer("file_size"),
  storagePath: text("storage_path"),
  processingStatus: text("processing_status").notNull().default("ready"),
  extractedText: text("extracted_text"),
  ...timestamps,
});

export const conceptsTable = pgTable("recall_concepts", {
  id: uuid("id").defaultRandom().primaryKey(),
  subjectId: uuid("subject_id")
    .notNull()
    .references(() => subjectsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  ...timestamps,
});

export const materialConceptsTable = pgTable("recall_material_concepts", {
  id: uuid("id").defaultRandom().primaryKey(),
  materialId: uuid("material_id")
    .notNull()
    .references(() => materialsTable.id, { onDelete: "cascade" }),
  conceptId: uuid("concept_id")
    .notNull()
    .references(() => conceptsTable.id, { onDelete: "cascade" }),
  relevanceScore: real("relevance_score").notNull().default(1),
});

export const questionsTable = pgTable("recall_questions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  subjectId: uuid("subject_id")
    .notNull()
    .references(() => subjectsTable.id, { onDelete: "cascade" }),
  materialId: uuid("material_id")
    .notNull()
    .references(() => materialsTable.id, { onDelete: "cascade" }),
  conceptId: uuid("concept_id")
    .notNull()
    .references(() => conceptsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  difficulty: text("difficulty").notNull(),
  questionText: text("question_text").notNull(),
  options: jsonb("options").$type<string[]>().notNull().default([]),
  correctAnswer: text("correct_answer").notNull(),
  explanation: text("explanation").notNull(),
  sourceExcerpt: text("source_excerpt").notNull(),
  sourcePage: integer("source_page"),
  generationVersion: text("generation_version").notNull().default("demo-v1"),
  ...timestamps,
});

export const practiceSessionsTable = pgTable("recall_practice_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  subjectId: uuid("subject_id")
    .notNull()
    .references(() => subjectsTable.id, { onDelete: "cascade" }),
  sessionType: text("session_type").notNull(),
  questionCount: integer("question_count").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  score: real("score"),
  ...timestamps,
});

export const sessionQuestionsTable = pgTable("recall_session_questions", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => practiceSessionsTable.id, { onDelete: "cascade" }),
  questionId: uuid("question_id")
    .notNull()
    .references(() => questionsTable.id, { onDelete: "cascade" }),
  orderIndex: integer("order_index").notNull(),
  userAnswer: text("user_answer"),
  isCorrect: boolean("is_correct"),
  confidence: text("confidence"),
  responseTimeMs: integer("response_time_ms"),
  ...timestamps,
});

export const conceptMasteryTable = pgTable("recall_concept_mastery", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  subjectId: uuid("subject_id")
    .notNull()
    .references(() => subjectsTable.id, { onDelete: "cascade" }),
  conceptId: uuid("concept_id")
    .notNull()
    .references(() => conceptsTable.id, { onDelete: "cascade" }),
  masteryScore: real("mastery_score").notNull().default(0),
  confidenceScore: real("confidence_score").notNull().default(0),
  questionsAttempted: integer("questions_attempted").notNull().default(0),
  questionsCorrect: integer("questions_correct").notNull().default(0),
  lastPracticedAt: timestamp("last_practiced_at", { withTimezone: true }),
  ...timestamps,
});

export const insertSubjectSchema = createInsertSchema(subjectsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSubject = typeof subjectsTable.$inferInsert;
export type Subject = typeof subjectsTable.$inferSelect;
export type Material = typeof materialsTable.$inferSelect;
export type Concept = typeof conceptsTable.$inferSelect;
export type Question = typeof questionsTable.$inferSelect;
export type PracticeSession = typeof practiceSessionsTable.$inferSelect;