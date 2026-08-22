import { and, asc, count, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  conceptMasteryTable,
  conceptsTable,
  materialConceptsTable,
  materialSectionsTable,
  materialsTable,
  questionsTable,
  practiceSessionsTable,
  sessionQuestionsTable,
  subjectsTable,
  subscriptionsTable,
} from "@workspace/db/schema";
import type {
  Concept,
  Material,
  PracticeResults,
  PracticeSession,
  Question,
  Subject,
  Subscription,
} from "@workspace/api-zod";
import { answersMatch, getAIService } from "./ai";
import type { GroundedConcept, GroundedSection } from "./ai";
import {
  extractConceptNames,
  extractMaterialText,
  splitMaterialText,
} from "./material-processing";
import { downloadPrivateObject } from "./object-storage";

type QuestionWithConcept = {
  question: typeof questionsTable.$inferSelect;
  conceptName: string;
};

const iso = (value: Date | null | undefined) =>
  value ? value.toISOString() : null;
const normalizedProcessingStatus = (value: string) => value.toUpperCase();

const questionToApi = (row: QuestionWithConcept): Question => ({
  id: row.question.id,
  questionText: row.question.questionText,
  type: row.question.type,
  options: row.question.options,
  concept: row.conceptName,
  difficulty: row.question.difficulty,
  sourceExcerpt: row.question.sourceExcerpt,
  sourcePage: row.question.sourcePage ?? 1,
  sourceSectionId: row.question.sectionId,
  explanation: row.question.explanation,
  correctAnswer: row.question.correctAnswer,
});

export const ensureRecallData = async (_userId: string) => undefined;

export async function listSubjects(userId: string): Promise<Subject[]> {
  const rows = await db.select().from(subjectsTable).where(eq(subjectsTable.userId, userId));
  const materials = await db
    .select({ subjectId: materialsTable.subjectId })
    .from(materialsTable)
    .where(eq(materialsTable.userId, userId));
  const counts = new Map<string, number>();
  for (const material of materials) {
    counts.set(material.subjectId, (counts.get(material.subjectId) ?? 0) + 1);
  }
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    materialCount: counts.get(row.id) ?? 0,
  }));
}

export async function createSubject(
  userId: string,
  input: { name: string; description?: string; color?: string },
) {
  const [row] = await db
    .insert(subjectsTable)
    .values({
      userId,
      name: input.name,
      description: input.description ?? "",
      color: input.color ?? "violet",
    })
    .returning();
  return { ...row, materialCount: 0 };
}

export async function listMaterials(userId: string): Promise<Material[]> {
  const rows = await db
    .select({
      material: materialsTable,
      subjectName: subjectsTable.name,
    })
    .from(materialsTable)
    .innerJoin(subjectsTable, eq(materialsTable.subjectId, subjectsTable.id))
    .where(eq(materialsTable.userId, userId))
    .orderBy(desc(materialsTable.createdAt));
  const sessions = await db
    .select({
      materialId: questionsTable.materialId,
      sessionId: practiceSessionsTable.id,
      startedAt: practiceSessionsTable.startedAt,
    })
    .from(sessionQuestionsTable)
    .innerJoin(
      questionsTable,
      eq(sessionQuestionsTable.questionId, questionsTable.id),
    )
    .innerJoin(
      practiceSessionsTable,
      eq(sessionQuestionsTable.sessionId, practiceSessionsTable.id),
    )
    .where(eq(practiceSessionsTable.userId, userId));
  const sessionCounts = new Map<string, Set<string>>();
  const lastStudiedByMaterial = new Map<string, Date>();
  for (const row of sessions) {
    const ids = sessionCounts.get(row.materialId) ?? new Set<string>();
    ids.add(row.sessionId);
    sessionCounts.set(row.materialId, ids);
    const previous = lastStudiedByMaterial.get(row.materialId);
    if (!previous || row.startedAt > previous) {
      lastStudiedByMaterial.set(row.materialId, row.startedAt);
    }
  }
  const conceptCounts = await db
    .select({ materialId: materialConceptsTable.materialId, total: count() })
    .from(materialConceptsTable)
    .innerJoin(materialsTable, eq(materialConceptsTable.materialId, materialsTable.id))
    .where(eq(materialsTable.userId, userId))
    .groupBy(materialConceptsTable.materialId);
  const conceptsByMaterial = new Map(
    conceptCounts.map((row) => [row.materialId, Number(row.total)]),
  );
  return rows.map(({ material, subjectName }) => ({
    id: material.id,
    title: material.title,
    subjectId: material.subjectId,
    subjectName,
    fileType: material.fileType,
    processingStatus: normalizedProcessingStatus(material.processingStatus),
    processingError: material.processingError,
    concepts: conceptsByMaterial.get(material.id) ?? 0,
    sessions: sessionCounts.get(material.id)?.size ?? 0,
    lastStudied: iso(lastStudiedByMaterial.get(material.id)),
    createdAt: material.createdAt.toISOString(),
    excerpt:
      material.extractedText?.slice(0, 180) ??
      "Processing material…",
  }));
}

export async function getMaterial(userId: string, id: string) {
  const materials = await listMaterials(userId);
  return materials.find((material) => material.id === id);
}

export async function createMaterial(
  userId: string,
  input: {
    title: string;
    subjectId: string;
    fileType: string;
    originalFileName?: string;
    fileSize?: number;
    storagePath?: string;
    pastedText?: string;
  },
) {
  const [row] = await db
    .insert(materialsTable)
    .values({
      userId,
      subjectId: input.subjectId,
      title: input.title,
      originalFileName: input.originalFileName ?? input.title,
      fileType: input.fileType,
      fileSize: input.fileSize ?? null,
      storagePath: input.storagePath ?? null,
      processingStatus: "PROCESSING",
      extractedText: input.pastedText ?? null,
    })
    .returning();
  return getMaterial(userId, row.id);
}

export async function processMaterial(userId: string, materialId: string) {
  const [material] = await db
    .select()
    .from(materialsTable)
    .where(and(eq(materialsTable.id, materialId), eq(materialsTable.userId, userId)))
    .limit(1);
  if (!material) return false;
  try {
    const bytes = material.storagePath
      ? await downloadPrivateObject(material.storagePath)
      : Buffer.from(material.extractedText ?? "", "utf8");
    const text = await extractMaterialText(
      bytes,
      material.fileType,
      material.originalFileName ?? material.title,
    );
    if (!text.trim()) throw new Error("The material did not contain any readable text.");
    const sections = splitMaterialText(text);
    const conceptNames = extractConceptNames(text);
    await db.transaction(async (tx) => {
      await tx.delete(materialSectionsTable).where(
        and(
          eq(materialSectionsTable.materialId, materialId),
          eq(materialSectionsTable.userId, userId),
        ),
      );
      await tx.delete(materialConceptsTable).where(
        eq(materialConceptsTable.materialId, materialId),
      );
      await tx.insert(materialSectionsTable).values(
        sections.map((content, sectionIndex) => ({
          materialId,
          userId,
          sectionIndex,
          title: `Section ${sectionIndex + 1}`,
          content,
        })),
      );
      const concepts = [];
      for (const name of conceptNames) {
        const [existing] = await tx
          .select()
          .from(conceptsTable)
          .where(
            and(
              eq(conceptsTable.userId, userId),
              eq(conceptsTable.subjectId, material.subjectId),
              eq(conceptsTable.name, name),
            ),
          )
          .limit(1);
        const [concept] = existing
          ? [existing]
          : await tx
              .insert(conceptsTable)
              .values({
                userId,
                subjectId: material.subjectId,
                name,
                description: `Extracted from ${material.title}`,
              })
              .returning();
        concepts.push(concept);
      }
      if (concepts.length) {
        await tx.insert(materialConceptsTable).values(
          concepts.map((concept) => ({
            materialId,
            conceptId: concept.id,
            relevanceScore: 1,
          })),
        );
      }
      await tx
        .update(materialsTable)
        .set({
          extractedText: text,
          processingStatus: "READY",
          processingError: null,
        })
        .where(
          and(eq(materialsTable.id, materialId), eq(materialsTable.userId, userId)),
        );
    });
    return true;
  } catch (error) {
    await db
      .update(materialsTable)
      .set({
        processingStatus: "FAILED",
        processingError:
          error instanceof Error ? error.message : "Material processing failed",
      })
      .where(and(eq(materialsTable.id, materialId), eq(materialsTable.userId, userId)));
    return false;
  }
}

export async function listMaterialSections(userId: string, materialId: string) {
  const rows = await db
    .select({ section: materialSectionsTable })
    .from(materialSectionsTable)
    .innerJoin(
      materialsTable,
      and(
        eq(materialSectionsTable.materialId, materialsTable.id),
        eq(materialsTable.userId, userId),
      ),
    )
    .where(
      and(
        eq(materialSectionsTable.materialId, materialId),
        eq(materialSectionsTable.userId, userId),
      ),
    )
    .orderBy(asc(materialSectionsTable.sectionIndex));
  return rows.map(({ section }) => section);
}

export async function generateQuestionsForMaterial(
  userId: string,
  materialId: string,
  count = 6,
) {
  const [material] = await db
    .select()
    .from(materialsTable)
    .where(and(eq(materialsTable.id, materialId), eq(materialsTable.userId, userId)))
    .limit(1);
  if (!material || normalizedProcessingStatus(material.processingStatus) !== "READY") return undefined;

  const sections = await db
    .select()
    .from(materialSectionsTable)
    .where(
      and(
        eq(materialSectionsTable.materialId, materialId),
        eq(materialSectionsTable.userId, userId),
      ),
    )
    .orderBy(asc(materialSectionsTable.sectionIndex));
  const concepts = await db
    .select({ id: conceptsTable.id, name: conceptsTable.name })
    .from(materialConceptsTable)
    .innerJoin(conceptsTable, eq(materialConceptsTable.conceptId, conceptsTable.id))
    .where(
      and(
        eq(materialConceptsTable.materialId, materialId),
        eq(conceptsTable.userId, userId),
      ),
    );
  if (!sections.length || !concepts.length) return [];

  const existing = await db
    .select({ questionText: questionsTable.questionText })
    .from(questionsTable)
    .where(eq(questionsTable.userId, userId));
  const groundedSections: GroundedSection[] = sections.map((section) => ({
    id: section.id,
    materialId: section.materialId,
    sectionIndex: section.sectionIndex,
    content: section.content,
  }));
  const groundedConcepts: GroundedConcept[] = concepts;
  const generated = getAIService().generateQuestionsFromSections(
    groundedSections,
    groundedConcepts,
    { count, excludeQuestionTexts: existing.map((row) => row.questionText) },
  );
  if (!generated.length) return [];
  const conceptsByName = new Map(concepts.map((concept) => [concept.name.toLowerCase(), concept.id]));
  const inserted = await db.transaction(async (tx) => {
    return tx.insert(questionsTable).values(
      generated.map((question) => ({
        userId,
        subjectId: material.subjectId,
        materialId,
        sectionId: question.sectionId,
        conceptId: conceptsByName.get(question.concept.toLowerCase())!,
        type: question.type,
        difficulty: question.difficulty,
        questionText: question.questionText,
        options: question.options,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
        sourceExcerpt: question.sourceExcerpt,
        sourcePage: question.sourcePage,
        generationVersion: "development-v1",
      })),
    ).returning();
  });
  const conceptNamesById = new Map(concepts.map((concept) => [concept.id, concept.name]));
  return inserted.map((question) =>
    questionToApi({
      question,
      conceptName: conceptNamesById.get(question.conceptId) ?? "Unknown concept",
    }),
  );
}

export async function deleteMaterial(userId: string, id: string) {
  const deleted = await db
    .delete(materialsTable)
    .where(and(eq(materialsTable.id, id), eq(materialsTable.userId, userId)))
    .returning({ id: materialsTable.id });
  return deleted.length > 0;
}

export async function listConcepts(userId: string): Promise<Concept[]> {
  const rows = await db
    .select({
      concept: conceptsTable,
      subjectName: subjectsTable.name,
      masteryScore: conceptMasteryTable.masteryScore,
      questionsAttempted: conceptMasteryTable.questionsAttempted,
      lastPracticedAt: conceptMasteryTable.lastPracticedAt,
    })
    .from(conceptsTable)
    .innerJoin(subjectsTable, eq(conceptsTable.subjectId, subjectsTable.id))
    .leftJoin(
      conceptMasteryTable,
      and(
        eq(conceptMasteryTable.conceptId, conceptsTable.id),
        eq(conceptMasteryTable.userId, userId),
      ),
    )
    .where(eq(subjectsTable.userId, userId))
    .orderBy(asc(conceptsTable.name));
  return rows.map((row) => ({
    id: row.concept.id,
    name: row.concept.name,
    subjectId: row.concept.subjectId,
    subjectName: row.subjectName,
    masteryScore: row.masteryScore ?? 0,
    status:
      (row.masteryScore ?? 0) >= 80
        ? "strong"
        : (row.masteryScore ?? 0) < 50
          ? "weak"
          : "needs work",
    questionsAttempted: row.questionsAttempted ?? 0,
    lastPracticed: iso(row.lastPracticedAt),
    sourceMaterial: row.concept.description,
  }));
}

async function listAnsweredAttempts(userId: string) {
  return db
    .select({
      session: practiceSessionsTable,
      attempt: sessionQuestionsTable,
      question: questionsTable,
      conceptName: conceptsTable.name,
    })
    .from(sessionQuestionsTable)
    .innerJoin(
      practiceSessionsTable,
      eq(sessionQuestionsTable.sessionId, practiceSessionsTable.id),
    )
    .innerJoin(
      questionsTable,
      and(
        eq(sessionQuestionsTable.questionId, questionsTable.id),
        eq(questionsTable.userId, userId),
      ),
    )
    .innerJoin(conceptsTable, eq(questionsTable.conceptId, conceptsTable.id))
    .where(
      and(
        eq(practiceSessionsTable.userId, userId),
        isNotNull(sessionQuestionsTable.userAnswer),
      ),
    )
    .orderBy(desc(sessionQuestionsTable.createdAt));
}

export async function listMistakes(userId: string) {
  const rows = await listAnsweredAttempts(userId);
  return rows
    .filter(({ attempt }) => attempt.isCorrect === false)
    .map(({ attempt, question, conceptName }) => ({
      id: attempt.id,
      question: question.questionText,
      userAnswer: attempt.userAnswer ?? "",
      correctAnswer: question.correctAnswer,
      explanation: question.explanation,
      concept: conceptName,
      sourceExcerpt: question.sourceExcerpt,
      confidence: attempt.confidence ?? "Not recorded",
    }));
}

export async function listRecommendations(userId: string) {
  const concepts = await listConcepts(userId);
  return concepts
    .filter((concept) => concept.questionsAttempted > 0 && concept.masteryScore < 80)
    .sort((a, b) => a.masteryScore - b.masteryScore)
    .slice(0, 3)
    .map((concept) => ({
      id: concept.id,
      title: `Practice ${concept.name}`,
      reason: `${concept.questionsAttempted - Math.round((concept.masteryScore / 100) * concept.questionsAttempted)} of your recent answers on this concept need another pass.`,
      concept: concept.name,
      recommendedMinutes: 10,
      questionCount: 6,
      difficulty: concept.masteryScore < 50 ? "focused" : "review",
      action: "weakness",
    }));
}

const dateKey = (value: Date) => value.toISOString().slice(0, 10);

function calculateStreak(rows: Awaited<ReturnType<typeof listAnsweredAttempts>>) {
  const practicedDays = new Set(rows.map(({ session }) => dateKey(session.startedAt)));
  let streak = 0;
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  while (practicedDays.has(dateKey(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export async function getProgress(userId: string) {
  const [concepts, attempts] = await Promise.all([
    listConcepts(userId),
    listAnsweredAttempts(userId),
  ]);
  const now = Date.now();
  const weekStart = now - 7 * 24 * 60 * 60 * 1000;
  const previousWeekStart = now - 14 * 24 * 60 * 60 * 1000;
  const thisWeek = attempts.filter(({ session }) => session.startedAt.getTime() >= weekStart);
  const previousWeek = attempts.filter(
    ({ session }) =>
      session.startedAt.getTime() >= previousWeekStart &&
      session.startedAt.getTime() < weekStart,
  );
  const accuracy = (rows: typeof attempts) =>
    rows.length
      ? Math.round((rows.filter(({ attempt }) => attempt.isCorrect === true).length / rows.length) * 100)
      : 0;
  const confidenceValue = (confidence: string | null) =>
    confidence === "high" ? 100 : confidence === "medium" ? 67 : confidence === "low" ? 33 : 0;
  const confidence = (rows: typeof attempts) => {
    const values = rows
      .map(({ attempt }) => confidenceValue(attempt.confidence))
      .filter((value) => value > 0);
    return values.length
      ? Math.round(values.reduce((total, value) => total + value, 0) / values.length)
      : 0;
  };
  const weekly = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(now - (6 - index) * 24 * 60 * 60 * 1000);
    const key = dateKey(day);
    const rows = thisWeek.filter(({ session }) => dateKey(session.startedAt) === key);
    return {
      day: day.toLocaleDateString("en-US", { weekday: "short" }),
      minutes: Math.round(
        rows.reduce((total, { attempt }) => total + (attempt.responseTimeMs ?? 0), 0) / 60000,
      ),
      questions: rows.length,
    };
  });
  return {
    overallMastery: concepts.length
      ? Math.round(concepts.reduce((total, concept) => total + concept.masteryScore, 0) / concepts.length)
      : 0,
    changeThisWeek: accuracy(thisWeek) - accuracy(previousWeek),
    accuracy: accuracy(attempts),
    confidence: confidence(attempts),
    studyMinutes: Math.round(
      attempts.reduce((total, { attempt }) => total + (attempt.responseTimeMs ?? 0), 0) / 60000,
    ),
    questionsAnswered: attempts.length,
    weekly,
    concepts,
    streak: calculateStreak(attempts),
  };
}

async function waitForMaterialReady(userId: string, materialId: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [material] = await db
      .select({ processingStatus: materialsTable.processingStatus })
      .from(materialsTable)
      .where(and(eq(materialsTable.id, materialId), eq(materialsTable.userId, userId)))
      .limit(1);
    if (!material || normalizedProcessingStatus(material.processingStatus) !== "PROCESSING") {
      return material ? normalizedProcessingStatus(material.processingStatus) === "READY" : false;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

export async function createPractice(
  userId: string,
  input: { subjectId?: string; materialId?: string; questionCount: number; sessionType: string },
  selectedConceptIds?: string[],
): Promise<PracticeSession | undefined> {
  if (input.materialId) {
    const [material] = await db
      .select({ id: materialsTable.id })
      .from(materialsTable)
      .where(and(eq(materialsTable.id, input.materialId), eq(materialsTable.userId, userId)))
      .limit(1);
    if (!material) return undefined;
    if (!(await waitForMaterialReady(userId, material.id))) return undefined;
    const existing = await db
      .select({ id: questionsTable.id })
      .from(questionsTable)
      .where(
        and(
          eq(questionsTable.userId, userId),
          eq(questionsTable.materialId, input.materialId),
          ne(questionsTable.generationVersion, "seed-v1"),
        ),
      )
      .limit(1);
    if (!existing.length) {
      await generateQuestionsForMaterial(userId, input.materialId, input.questionCount);
    }
  } else {
    const userMaterials = await db
      .select({ id: materialsTable.id, processingStatus: materialsTable.processingStatus })
      .from(materialsTable)
      .where(
        and(
          eq(materialsTable.userId, userId),
          ...(input.subjectId ? [eq(materialsTable.subjectId, input.subjectId)] : []),
        ),
      );
    for (const material of userMaterials) {
      if (normalizedProcessingStatus(material.processingStatus) === "PROCESSING") {
        await waitForMaterialReady(userId, material.id);
      }
      const [readyMaterial] = await db
        .select({ id: materialsTable.id })
        .from(materialsTable)
        .where(
          and(
            eq(materialsTable.id, material.id),
            eq(materialsTable.userId, userId),
            eq(materialsTable.processingStatus, "READY"),
          ),
        )
        .limit(1);
      if (!readyMaterial) continue;
      const [existing] = await db
        .select({ id: questionsTable.id })
        .from(questionsTable)
        .where(
          and(
            eq(questionsTable.userId, userId),
            eq(questionsTable.materialId, readyMaterial.id),
            ne(questionsTable.generationVersion, "seed-v1"),
          ),
        )
        .limit(1);
      if (!existing) {
        await generateQuestionsForMaterial(userId, readyMaterial.id, input.questionCount);
      }
    }
  }
  return db.transaction(async (tx) => {
    const conditions = [
      eq(questionsTable.userId, userId),
      ne(questionsTable.generationVersion, "seed-v1"),
    ];
    if (input.materialId) conditions.push(eq(questionsTable.materialId, input.materialId));
    if (input.subjectId) conditions.push(eq(questionsTable.subjectId, input.subjectId));
    if (selectedConceptIds?.length) {
      conditions.push(inArray(questionsTable.conceptId, selectedConceptIds));
    }
    let rows = await tx
      .select({ question: questionsTable, conceptName: conceptsTable.name })
      .from(questionsTable)
      .innerJoin(conceptsTable, eq(questionsTable.conceptId, conceptsTable.id))
      .where(and(...conditions))
      .orderBy(asc(questionsTable.createdAt));
    if (!rows.length) return undefined;
    const selected = rows.slice(0, Math.max(1, Math.min(input.questionCount, 20)));
    const subject = input.subjectId
      ? (
          await tx
            .select()
            .from(subjectsTable)
            .where(and(eq(subjectsTable.id, input.subjectId), eq(subjectsTable.userId, userId)))
            .limit(1)
        )[0]
      : undefined;
    if (input.subjectId && !subject) return undefined;
    if (input.materialId) {
      const [material] = await tx
        .select({ id: materialsTable.id })
        .from(materialsTable)
        .where(and(eq(materialsTable.id, input.materialId), eq(materialsTable.userId, userId)))
        .limit(1);
      if (!material) return undefined;
    }
    const [session] = await tx
      .insert(practiceSessionsTable)
      .values({
        userId,
        subjectId: input.subjectId ?? selected[0]?.question.subjectId ?? subject?.id!,
        sessionType: input.sessionType,
        questionCount: selected.length,
      })
      .returning();
    await tx.insert(sessionQuestionsTable).values(
      selected.map((row, index) => ({
        sessionId: session.id,
        questionId: row.question.id,
        orderIndex: index,
      })),
    );
    return {
      id: session.id,
      title: subject ? `${subject.name} practice` : "Recommended practice",
      sessionType: input.sessionType,
      subjectName: subject?.name ?? "Focused practice",
      questions: selected.map(questionToApi),
      currentIndex: 0,
      completed: false,
    };
  });
}

export async function getPractice(userId: string, sessionId: string) {
  const [session] = await db
    .select()
    .from(practiceSessionsTable)
    .where(and(eq(practiceSessionsTable.id, sessionId), eq(practiceSessionsTable.userId, userId)))
    .limit(1);
  if (!session) return undefined;
  const rows = await db
    .select({
      question: questionsTable,
      conceptName: conceptsTable.name,
    })
    .from(sessionQuestionsTable)
    .innerJoin(
      questionsTable,
      and(
        eq(sessionQuestionsTable.questionId, questionsTable.id),
        eq(questionsTable.userId, userId),
        ne(questionsTable.generationVersion, "seed-v1"),
      ),
    )
    .innerJoin(conceptsTable, eq(questionsTable.conceptId, conceptsTable.id))
    .where(eq(sessionQuestionsTable.sessionId, sessionId))
    .orderBy(asc(sessionQuestionsTable.orderIndex));
  const subject = (
    await db
      .select()
      .from(subjectsTable)
      .where(and(eq(subjectsTable.id, session.subjectId), eq(subjectsTable.userId, userId)))
      .limit(1)
  )[0];
  return {
    id: session.id,
    title: subject ? `${subject.name} practice` : "Recommended practice",
    sessionType: session.sessionType,
    subjectName: subject?.name ?? "Focused practice",
    questions: rows.map(questionToApi),
    currentIndex: await answeredCount(sessionId),
    completed: Boolean(session.completedAt),
    ...(session.completedAt
      ? { results: await summarizePractice(userId, sessionId) }
      : {}),
  } satisfies PracticeSession;
}

async function answeredCount(sessionId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(sessionQuestionsTable)
    .where(
      and(
        eq(sessionQuestionsTable.sessionId, sessionId),
        isNotNull(sessionQuestionsTable.userAnswer),
      ),
    );
  return Number(row?.value ?? 0);
}

export async function answerPractice(
  userId: string,
  sessionId: string,
  input: { questionId: string; answer: string; confidence?: string; responseTimeMs?: number },
) {
  const [session] = await db
    .select()
    .from(practiceSessionsTable)
    .where(and(eq(practiceSessionsTable.id, sessionId), eq(practiceSessionsTable.userId, userId)))
    .limit(1);
  if (!session) return undefined;
  const [row] = await db
    .select({ question: questionsTable, conceptName: conceptsTable.name })
    .from(sessionQuestionsTable)
    .innerJoin(questionsTable, eq(sessionQuestionsTable.questionId, questionsTable.id))
    .innerJoin(conceptsTable, eq(questionsTable.conceptId, conceptsTable.id))
    .where(
      and(
        eq(sessionQuestionsTable.sessionId, sessionId),
        eq(sessionQuestionsTable.questionId, input.questionId),
      ),
    )
    .limit(1);
  if (!row || row.question.userId !== userId) return null;
  if (session.completedAt) return { sessionCompleted: true as const };
  const normalizedAnswer = input.answer.trim().replace(/\s+/g, " ");
  const isCorrect = answersMatch(
    row.question.correctAnswer,
    normalizedAnswer,
    row.question.type as Question["type"],
  );
  await db
    .update(sessionQuestionsTable)
    .set({
      userAnswer: normalizedAnswer,
      isCorrect,
      confidence: input.confidence ?? null,
      responseTimeMs: input.responseTimeMs ?? null,
    })
    .where(
      and(
        eq(sessionQuestionsTable.sessionId, sessionId),
        eq(sessionQuestionsTable.questionId, input.questionId),
      ),
    );
  return {
    isCorrect,
    correctAnswer: row.question.correctAnswer,
    explanation: row.question.explanation,
    concept: row.conceptName,
    sourceExcerpt: row.question.sourceExcerpt,
  };
}

async function summarizePractice(userId: string, sessionId: string): Promise<PracticeResults> {
  const [session] = await db
    .select()
    .from(practiceSessionsTable)
    .where(and(eq(practiceSessionsTable.id, sessionId), eq(practiceSessionsTable.userId, userId)))
    .limit(1);
  if (!session) throw new Error("Practice session not found");
  const answers = await db
    .select()
    .from(sessionQuestionsTable)
    .where(eq(sessionQuestionsTable.sessionId, sessionId))
    .orderBy(asc(sessionQuestionsTable.orderIndex));
  const answered = answers.filter((answer) => answer.userAnswer !== null);
  const correct = answered.filter((answer) => answer.isCorrect === true).length;
  const questionRows = await db
    .select({
      concept: conceptsTable.name,
      questionId: sessionQuestionsTable.questionId,
    })
    .from(sessionQuestionsTable)
    .innerJoin(questionsTable, eq(sessionQuestionsTable.questionId, questionsTable.id))
    .innerJoin(conceptsTable, eq(questionsTable.conceptId, conceptsTable.id))
    .where(eq(sessionQuestionsTable.sessionId, sessionId));
  const wrongConcepts = Array.from(
    new Set(
      questionRows
        .filter((row) => answers.find((answer) => answer.questionId === row.questionId)?.isCorrect === false)
        .map((row) => row.concept),
    ),
  );
  const strongConcepts = Array.from(
    new Set(
      questionRows
        .filter((row) => {
          const answer = answers.find((item) => item.questionId === row.questionId);
          return answer?.isCorrect === true;
        })
        .map((row) => row.concept),
    ),
  ).filter((concept) => !wrongConcepts.includes(concept));
  const confidenceValues = answered.map((answer) => answer.confidence).filter(Boolean);
  const averageResponseTimeMs = answered
    .map((answer) => answer.responseTimeMs)
    .filter((value): value is number => value !== null);
  const score = answered.length ? Math.round((correct / answered.length) * 100) : 0;
  return {
    id: sessionId,
    score: session.score ?? score,
    questionsAnswered: answered.length,
    correct,
    incorrect: answered.length - correct,
    averageConfidence: confidenceValues.length
      ? confidenceValues[confidenceValues.length - 1]!
      : "Not recorded",
    averageResponseTime: averageResponseTimeMs.length
      ? `${Math.round(averageResponseTimeMs.reduce((total, value) => total + value, 0) / averageResponseTimeMs.length / 1000)} sec`
      : "Not recorded",
    strongConcepts: strongConcepts.slice(0, 3),
    needsAttention: wrongConcepts.slice(0, 2),
    weakConcepts: wrongConcepts.slice(0, 1),
    diagnosis: wrongConcepts.length
      ? `The pattern suggests you understand the broad idea but need a clearer distinction in ${wrongConcepts[0]}.`
      : "You're building reliable recall. Keep mixing question types so the knowledge sticks.",
    improvement: session.sessionType === "weakness" ? 12 : 0,
  };
}

export async function completePractice(
  userId: string,
  sessionId: string,
): Promise<PracticeResults | undefined> {
  const completed = await db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(practiceSessionsTable)
      .where(and(eq(practiceSessionsTable.id, sessionId), eq(practiceSessionsTable.userId, userId)))
      .limit(1);
    if (!session) return undefined;
    const answers = await tx
      .select()
      .from(sessionQuestionsTable)
      .where(eq(sessionQuestionsTable.sessionId, sessionId));
    const answered = answers.filter((answer) => answer.userAnswer !== null);
    const correct = answered.filter((answer) => answer.isCorrect).length;
    const score = answered.length ? Math.round((correct / answered.length) * 100) : 0;
    await tx
      .update(practiceSessionsTable)
      .set({ completedAt: new Date(), score })
      .where(eq(practiceSessionsTable.id, sessionId));
    return sessionId;
  });
  return completed ? summarizePractice(userId, sessionId) : undefined;
}

export async function getSubscription(userId: string): Promise<Subscription> {
  const [subscription] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, userId))
    .limit(1);
  const [materialCount] = await db
    .select({ value: count() })
    .from(materialsTable)
    .where(eq(materialsTable.userId, userId));
  const [sessionCount] = await db
    .select({ value: count() })
    .from(practiceSessionsTable)
    .where(eq(practiceSessionsTable.userId, userId));
  const resetDate = subscription?.currentPeriodEnd
    ? subscription.currentPeriodEnd.toISOString().slice(0, 10)
    : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1))
        .toISOString()
        .slice(0, 10);
  return {
    plan: subscription?.plan ?? "free",
    status: subscription?.status ?? "free",
    sessionsUsed: Number(sessionCount?.value ?? 0),
    sessionsLimit: 5,
    materialsUsed: Number(materialCount?.value ?? 0),
    materialsLimit: 5,
    resetDate,
  };
}
