import { and, asc, count, desc, eq, inArray, isNotNull } from "drizzle-orm";
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
import {
  demoConcepts,
  demoMaterials,
  demoQuestions,
  demoSubjects,
} from "./recall-demo";
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

const seedPromises = new Map<string, Promise<string>>();

const iso = (value: Date | null | undefined) =>
  value ? value.toISOString() : null;

const questionToApi = (row: QuestionWithConcept): Question => ({
  id: row.question.id,
  questionText: row.question.questionText,
  type: row.question.type,
  options: row.question.options,
  concept: row.conceptName,
  difficulty: row.question.difficulty,
  sourceExcerpt: row.question.sourceExcerpt,
  sourcePage: row.question.sourcePage ?? 1,
  explanation: row.question.explanation,
  correctAnswer: row.question.correctAnswer,
});

async function seedRecallData(userId: string) {
  return db.transaction(async (tx) => {
    const [subscription] = await tx
      .select({ id: subscriptionsTable.id })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, userId))
      .limit(1);
    if (!subscription) {
      await tx.insert(subscriptionsTable).values({ userId });
    }

    const existingSubjects = await tx
      .select()
      .from(subjectsTable)
      .where(eq(subjectsTable.userId, userId));
    const subjectIds = new Map(existingSubjects.map((subject) => [subject.name, subject.id]));
    if (existingSubjects.length === 0) {
      const inserted = await tx
        .insert(subjectsTable)
        .values(
          demoSubjects.map((subject) => ({
            userId,
            name: subject.name,
            description: subject.description,
            color: subject.color,
          })),
        )
        .returning();
      for (const subject of inserted) subjectIds.set(subject.name, subject.id);
    }

    const existingMaterials = await tx
      .select()
      .from(materialsTable)
      .where(eq(materialsTable.userId, userId));
    const materialIds = new Map(
      existingMaterials.map((material) => [material.title, material.id]),
    );
    if (existingMaterials.length === 0) {
      const seededMaterials = [
        ...demoMaterials,
        {
          title: "Motion & Forces",
          subjectName: "Physics",
          fileType: "Pasted notes",
          excerpt:
            "Average acceleration is the change in velocity divided by the time interval.",
        },
      ];
      const inserted = await tx
        .insert(materialsTable)
        .values(
          seededMaterials.map((material) => ({
            userId,
            subjectId: subjectIds.get(material.subjectName)!,
            title: material.title,
            originalFileName: material.title,
            fileType: material.fileType,
            processingStatus: "READY",
            extractedText: material.excerpt,
          })),
        )
        .returning();
      for (const material of inserted) materialIds.set(material.title, material.id);
    }

    const existingConcepts = await tx
      .select({ concept: conceptsTable })
      .from(conceptsTable)
      .innerJoin(subjectsTable, eq(conceptsTable.subjectId, subjectsTable.id))
      .where(eq(subjectsTable.userId, userId));
    const conceptIds = new Map(existingConcepts.map(({ concept }) => [concept.name, concept.id]));
    if (existingConcepts.length === 0) {
      const inserted = await tx
        .insert(conceptsTable)
        .values(
          demoConcepts.map((concept) => ({
            userId,
            subjectId: subjectIds.get(concept.subjectName)!,
            name: concept.name,
            description: concept.sourceMaterial,
          })),
        )
        .returning();
      for (const concept of inserted) conceptIds.set(concept.name, concept.id);
      await tx.insert(conceptMasteryTable).values(
        demoConcepts.map((concept) => ({
            userId,
          subjectId: subjectIds.get(concept.subjectName)!,
          conceptId: conceptIds.get(concept.name)!,
          masteryScore: concept.masteryScore,
          questionsAttempted: concept.questionsAttempted,
          lastPracticedAt: concept.lastPracticed
            ? new Date(concept.lastPracticed)
            : null,
        })),
      );
    }

    const existingQuestions = await tx
      .select({ id: questionsTable.id })
      .from(questionsTable)
      .where(eq(questionsTable.userId, userId))
      .limit(1);
    if (existingQuestions.length === 0) {
      const materialForConcept = (concept: string) =>
        concept === "Kinematics"
          ? materialIds.get("Motion & Forces")
          : ["Osmosis", "Membrane transport"].includes(concept)
            ? materialIds.get("Cell Membranes & Transport")
            : concept === "Neural signaling"
              ? materialIds.get("Neural Signaling Notes")
              : materialIds.get("Cardiovascular System");
      await tx.insert(questionsTable).values(
        demoQuestions.map((question) => ({
           userId,
          subjectId: subjectIds.get(
            ["Osmosis", "Membrane transport"].includes(question.concept)
              ? "Cell Biology"
              : question.concept === "Kinematics"
                ? "Physics"
                : "Human Anatomy",
          )!,
          materialId: materialForConcept(question.concept)!,
          conceptId: conceptIds.get(question.concept)!,
          type: question.type,
          difficulty: question.difficulty,
          questionText: question.questionText,
          options: question.options,
          correctAnswer: question.correctAnswer,
          explanation: question.explanation,
          sourceExcerpt: question.sourceExcerpt,
          sourcePage: question.sourcePage,
          generationVersion: "seed-v1",
        })),
      );
    }

    return userId;
  });
}

export const ensureRecallData = (userId: string) => {
  const existing = seedPromises.get(userId);
  if (existing) return existing;
  const promise = seedRecallData(userId).catch((error) => {
    seedPromises.delete(userId);
    throw error;
  });
  seedPromises.set(userId, promise);
  return promise;
};

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
  for (const row of sessions) {
    const ids = sessionCounts.get(row.materialId) ?? new Set<string>();
    ids.add(row.sessionId);
    sessionCounts.set(row.materialId, ids);
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
    processingStatus: material.processingStatus,
    processingError: material.processingError,
    concepts: conceptsByMaterial.get(material.id) ?? 0,
    sessions: sessionCounts.get(material.id)?.size ?? 0,
    lastStudied: null,
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

async function questionRows(userId: string, questionIds?: string[]) {
  const conditions = [eq(questionsTable.userId, userId)];
  if (questionIds?.length) conditions.push(inArray(questionsTable.id, questionIds));
  return db
    .select({
      question: questionsTable,
      conceptName: conceptsTable.name,
    })
    .from(questionsTable)
    .innerJoin(conceptsTable, eq(questionsTable.conceptId, conceptsTable.id))
    .where(and(...conditions));
}

export async function createPractice(
  userId: string,
  input: { subjectId?: string; materialId?: string; questionCount: number; sessionType: string },
  selectedConceptIds?: string[],
): Promise<PracticeSession | undefined> {
  return db.transaction(async (tx) => {
    const conditions = [eq(questionsTable.userId, userId)];
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
    if (!rows.length) {
      rows = await tx
        .select({ question: questionsTable, conceptName: conceptsTable.name })
        .from(questionsTable)
        .innerJoin(conceptsTable, eq(questionsTable.conceptId, conceptsTable.id))
        .where(eq(questionsTable.userId, userId))
        .orderBy(asc(questionsTable.createdAt));
    }
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
  const rows = await questionRows(
    userId,
    (
      await db
        .select({ questionId: sessionQuestionsTable.questionId })
        .from(sessionQuestionsTable)
        .where(eq(sessionQuestionsTable.sessionId, sessionId))
        .orderBy(asc(sessionQuestionsTable.orderIndex))
    ).map((row) => row.questionId),
  );
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
  if (!row) return null;
  const isCorrect =
    row.question.correctAnswer.trim().toLowerCase() === input.answer.trim().toLowerCase();
  await db
    .update(sessionQuestionsTable)
    .set({
      userAnswer: input.answer,
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

export async function completePractice(
  userId: string,
  sessionId: string,
): Promise<PracticeResults | undefined> {
  return db.transaction(async (tx) => {
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
    const questionRows = await tx
      .select({ concept: conceptsTable.name, questionId: sessionQuestionsTable.questionId })
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
    await tx
      .update(practiceSessionsTable)
      .set({ completedAt: new Date(), score })
      .where(eq(practiceSessionsTable.id, sessionId));
    return {
      id: sessionId,
      score,
      questionsAnswered: answered.length,
      correct,
      incorrect: answered.length - correct,
      averageConfidence: answered.some((answer) => answer.confidence === "Guessing")
        ? "Somewhat sure"
        : "Very sure",
      averageResponseTime: "18 sec",
      strongConcepts: score >= 80 ? ["Heart anatomy"] : [],
      needsAttention: wrongConcepts.slice(0, 2),
      weakConcepts: wrongConcepts.slice(0, 1),
      diagnosis: wrongConcepts.length
        ? `The pattern suggests you understand the broad idea but need a clearer distinction in ${wrongConcepts[0]}.`
        : "You're building reliable recall. Keep mixing question types so the knowledge sticks.",
      improvement: session.sessionType === "weakness" ? 12 : 0,
    };
  });
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
  return {
    plan: subscription?.plan ?? "free",
    status: subscription?.status ?? "free",
    sessionsUsed: Number(sessionCount?.value ?? 0),
    sessionsLimit: 5,
    materialsUsed: Number(materialCount?.value ?? 0),
    materialsLimit: 5,
    resetDate: "2026-09-01",
  };
}
