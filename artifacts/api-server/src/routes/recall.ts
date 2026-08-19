import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  AnswerPracticeBody,
  CreateCheckoutBody,
  CreateMaterialBody,
  CreatePracticeBody,
  CreateSubjectBody,
  CreateWeaknessPracticeBody,
} from "@workspace/api-zod";
import {
  buildDashboard,
  buildProgress,
  createDemoSession,
  demoConcepts,
  demoMaterials,
  demoMistakes,
  demoQuestions,
  demoSubjects,
  practiceSessions,
  recommendation,
  resultStore,
  subscription,
} from "../lib/recall-demo";
import { generateGroundedQuestions } from "../lib/ai";

const router: IRouter = Router();

router.get("/dashboard", (_req, res) => {
  res.json(buildDashboard());
});

router.get("/subjects", (_req, res) => {
  res.json(demoSubjects);
});

router.post("/subjects", (req, res) => {
  const input = CreateSubjectBody.parse(req.body);
  const subject = {
    id: randomUUID(),
    name: input.name,
    description: input.description ?? "",
    color: input.color ?? "violet",
    materialCount: 0,
  };
  demoSubjects.unshift(subject);
  res.status(201).json(subject);
});

router.get("/materials", (_req, res) => {
  res.json(demoMaterials);
});

router.post("/materials", (req, res) => {
  const input = CreateMaterialBody.parse(req.body);
  const subject = demoSubjects.find((item) => item.id === input.subjectId);
  if (!subject) {
    res.status(404).json({ error: "Subject not found" });
    return;
  }

  const material = {
    id: randomUUID(),
    title: input.title,
    subjectId: subject.id,
    subjectName: subject.name,
    fileType: input.fileType,
    processingStatus: "ready",
    concepts: 0,
    sessions: 0,
    lastStudied: null,
    createdAt: new Date().toISOString(),
    excerpt:
      input.extractedText?.slice(0, 180) ||
      "Recall will identify the important ideas in this material.",
  };
  demoMaterials.unshift(material);
  subject.materialCount += 1;
  res.status(201).json(material);
});

router.get("/materials/:id", (req, res) => {
  const material = demoMaterials.find((item) => item.id === req.params.id);
  if (!material) {
    res.status(404).json({ error: "Material not found" });
    return;
  }
  res.json(material);
});

router.delete("/materials/:id", (req, res) => {
  const index = demoMaterials.findIndex((item) => item.id === req.params.id);
  if (index === -1) {
    res.status(404).json({ error: "Material not found" });
    return;
  }
  demoMaterials.splice(index, 1);
  res.status(204).send();
});

router.get("/concepts", (_req, res) => {
  res.json(demoConcepts);
});

router.post("/practice", (req, res) => {
  const input = CreatePracticeBody.parse(req.body);
  const subject = demoSubjects.find((item) => item.id === input.subjectId);
  const material = demoMaterials.find((item) => item.id === input.materialId);
  const filtered = demoQuestions.filter((question) => {
    if (input.materialId === "material-cell-membranes") {
      return ["Osmosis", "Membrane transport"].includes(question.concept);
    }
    if (input.subjectId === "subject-biology") {
      return ["Osmosis", "Membrane transport"].includes(question.concept);
    }
    if (input.subjectId === "subject-physics") {
      return question.concept === "Kinematics";
    }
    return true;
  });
  const questions = generateGroundedQuestions(
    filtered.length ? filtered : demoQuestions,
    input.questionCount,
  );
  const session = createDemoSession(
    material
      ? `${material.title} practice`
      : subject
        ? `${subject.name} practice`
        : "Recommended practice",
    "practice",
    subject?.name ?? material?.subjectName ?? "Human Anatomy",
    questions,
  );
  res.status(201).json(session);
});

router.post("/practice/weakness", (req, res) => {
  const input = CreateWeaknessPracticeBody.parse(req.body);
  const selectedNames = new Set(
    demoConcepts
      .filter((concept) => input.conceptIds.includes(concept.id))
      .map((concept) => concept.name),
  );
  const filtered = demoQuestions.filter((question) =>
    selectedNames.size
      ? selectedNames.has(question.concept)
      : ["Cardiac conduction", "Osmosis", "Membrane transport"].includes(
          question.concept,
        ),
  );
  const session = createDemoSession(
    "Weakness fix",
    "weakness",
    "Focused practice",
    generateGroundedQuestions(filtered.length ? filtered : demoQuestions, 6),
  );
  res.status(201).json(session);
});

router.get("/practice/:id", (req, res) => {
  const session = practiceSessions.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Practice session not found" });
    return;
  }
  res.json(session);
});

router.post("/practice/:id", (req, res) => {
  const session = practiceSessions.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Practice session not found" });
    return;
  }
  const input = AnswerPracticeBody.parse(req.body);
  const question = session.questions.find(
    (item) => item.id === input.questionId,
  );
  if (!question) {
    res.status(404).json({ error: "Question not found" });
    return;
  }
  const isCorrect =
    question.correctAnswer.trim().toLowerCase() ===
    input.answer.trim().toLowerCase();
  session.answers.push({ ...input, isCorrect, question });
  session.currentIndex = Math.min(
    session.questions.length - 1,
    session.currentIndex + 1,
  );
  res.json({
    isCorrect,
    correctAnswer: question.correctAnswer,
    explanation: question.explanation,
    concept: question.concept,
    sourceExcerpt: question.sourceExcerpt,
  });
});

router.post("/practice/:id/complete", (req, res) => {
  const session = practiceSessions.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Practice session not found" });
    return;
  }
  const correct = session.answers.filter((answer) => answer.isCorrect).length;
  const questionsAnswered = session.answers.length;
  const score = questionsAnswered
    ? Math.round((correct / questionsAnswered) * 100)
    : 0;
  const wrongConcepts = Array.from(
    new Set(
      session.answers
        .filter((answer) => !answer.isCorrect)
        .map((answer) => answer.question.concept),
    ),
  );
  const result = {
    id: session.id,
    score,
    questionsAnswered,
    correct,
    incorrect: questionsAnswered - correct,
    averageConfidence: session.answers.some(
      (answer) => answer.confidence === "Guessing",
    )
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
  session.completed = true;
  resultStore.set(session.id, result);
  res.json(result);
});

router.get("/progress", (_req, res) => {
  res.json(buildProgress());
});

router.get("/mistakes", (_req, res) => {
  res.json(demoMistakes);
});

router.get("/recommendations", (_req, res) => {
  res.json([
    recommendation,
    {
      id: "rec-osmosis",
      title: "Review osmosis",
      reason: "You haven't practiced this concept in 4 days.",
      concept: "Osmosis",
      recommendedMinutes: 8,
      questionCount: 5,
      difficulty: "medium",
      action: "practice",
    },
  ]);
});

router.get("/subscription", (_req, res) => {
  res.json(subscription);
});

router.post("/billing/checkout", (req, res) => {
  const input = CreateCheckoutBody.parse(req.body);
  const planCode =
    input.interval === "annual"
      ? process.env.PAYSTACK_PRO_ANNUAL_PLAN_CODE
      : process.env.PAYSTACK_PRO_MONTHLY_PLAN_CODE;
  const configured = Boolean(process.env.PAYSTACK_SECRET_KEY && planCode);
  res.json({
    url: null,
    configured,
    message: configured
      ? `Paystack checkout is ready for the ${input.interval} plan.`
      : "Paystack billing is not configured yet. Your learning data is safe, and you can keep using Recall Free.",
  });
});

router.get("/auth/session", (_req, res) => {
  res.json({
    authenticated: true,
    user: {
      id: "demo-user",
      name: "Alex Morgan",
      email: "alex@example.com",
    },
  });
});

export default router;