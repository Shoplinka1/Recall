import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { conceptsTable, materialSectionsTable, materialsTable, questionsTable, sessionQuestionsTable, practiceSessionsTable, usersTable } from "./recall";

export const teachingInterventionsTable = pgTable("recall_teaching_interventions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => practiceSessionsTable.id, { onDelete: "cascade" }),
  attemptId: uuid("attempt_id")
    .notNull()
    .references(() => sessionQuestionsTable.id, { onDelete: "cascade" }),
  questionId: uuid("question_id")
    .notNull()
    .references(() => questionsTable.id, { onDelete: "cascade" }),
  conceptId: uuid("concept_id")
    .notNull()
    .references(() => conceptsTable.id, { onDelete: "cascade" }),
  materialId: uuid("material_id")
    .notNull()
    .references(() => materialsTable.id, { onDelete: "cascade" }),
  sourceSectionId: uuid("source_section_id").references(() => materialSectionsTable.id, {
    onDelete: "set null",
  }),
  result: text("result").notNull(),
  explanation: text("explanation").notNull(),
  keyIdea: text("key_idea").notNull(),
  misconception: text("misconception"),
  followUpQuestionId: uuid("follow_up_question_id").references(() => questionsTable.id, {
    onDelete: "set null",
  }),
  followUpStatus: text("follow_up_status").notNull().default("none"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("recall_teaching_interventions_attempt_idx").on(table.attemptId),
]);

export type TeachingIntervention = typeof teachingInterventionsTable.$inferSelect;