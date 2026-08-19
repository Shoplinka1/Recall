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
  demoMistakes,
  recommendation,
} from "../lib/recall-demo";
import {
  answerPractice,
  completePractice,
  createMaterial,
  createPractice,
  createSubject,
  deleteMaterial,
  ensureRecallData,
  getMaterial,
  getPractice,
  getSubscription,
  listConcepts,
  listMaterials,
  listSubjects,
  listMaterialSections,
  processMaterial,
} from "../lib/recall-store";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.use(requireAuth);
router.use(async (req, _res, next) => {
  try {
    await ensureRecallData(req.auth!.id);
    next();
  } catch (error) {
    next(error);
  }
});

router.get("/dashboard", async (req, res, next) => {
  try {
    const user = req.auth!;
    const [materials, concepts, subscription] = await Promise.all([
      listMaterials(user.id),
      listConcepts(user.id),
      getSubscription(user.id),
    ]);
    res.json({
      greeting: `Good morning, ${user.name.split(" ")[0]}`,
      subtitle: "Your next best session is already waiting.",
      recommendation,
      stats: {
        weeklyMinutes: 42,
        weeklyGoal: 60,
        streak: 6,
        questionsAnswered: concepts.reduce(
          (total, concept) => total + concept.questionsAttempted,
          0,
        ),
        overallMastery: concepts.length
          ? Math.round(
              concepts.reduce((total, concept) => total + concept.masteryScore, 0) /
                concepts.length,
            )
          : 0,
      },
      recentMaterials: materials.slice(0, 3),
      concepts: [...concepts].sort((a, b) => a.masteryScore - b.masteryScore),
      subscription,
    });
    next();
  } catch (error) {
    next(error);
  }
});

router.get("/subjects", async (req, res, next) => {
  try {
    res.json(await listSubjects(req.auth!.id));
  } catch (error) {
    next(error);
  }
});

router.post("/subjects", async (req, res, next) => {
  try {
    const input = CreateSubjectBody.parse(req.body);
    const user = req.auth!;
    res.status(201).json(await createSubject(user.id, input));
  } catch (error) {
    next(error);
  }
});

router.get("/materials", async (req, res, next) => {
  try {
    res.json(await listMaterials(req.auth!.id));
  } catch (error) {
    next(error);
  }
});

router.post("/materials", async (req, res, next) => {
  try {
    const input = CreateMaterialBody.parse(req.body);
    const user = req.auth!;
    const subject = (await listSubjects(user.id)).find(
      (item) => item.id === input.subjectId,
    );
    if (!subject) {
      res.status(404).json({ error: "Subject not found" });
      return;
    }
    if (
      input.storagePath &&
      !input.storagePath.startsWith(`/objects/.private/uploads/${user.id}/`)
    ) {
      res.status(403).json({ error: "Material file ownership mismatch" });
      return;
    }
    if (!input.storagePath && !input.pastedText?.trim()) {
      res.status(400).json({ error: "Upload a file or paste non-empty text" });
      return;
    }
    const material = await createMaterial(user.id, input);
    res.status(201).json(material);
    void processMaterial(user.id, material!.id);
  } catch (error) {
    next(error);
  }
});

router.post("/materials/:id/retry", async (req, res, next) => {
  try {
    const material = await getMaterial(req.auth!.id, req.params.id);
    if (!material) {
      res.status(404).json({ error: "Material not found" });
      return;
    }
    const started = await processMaterial(req.auth!.id, req.params.id);
    if (!started) {
      res.status(422).json(await getMaterial(req.auth!.id, req.params.id));
      return;
    }
    res.json(await getMaterial(req.auth!.id, req.params.id));
  } catch (error) {
    next(error);
  }
});

router.get("/materials/:id", async (req, res, next) => {
  try {
    const user = req.auth!;
    const material = await getMaterial(user.id, req.params.id);
    if (!material) {
      res.status(404).json({ error: "Material not found" });
      return;
    }
    res.json(material);
  } catch (error) {
    next(error);
  }
});

router.get("/materials/:id/sections", async (req, res, next) => {
  try {
    if (!(await getMaterial(req.auth!.id, req.params.id))) {
      res.status(404).json({ error: "Material not found" });
      return;
    }
    res.json(await listMaterialSections(req.auth!.id, req.params.id));
  } catch (error) {
    next(error);
  }
});

router.delete("/materials/:id", async (req, res, next) => {
  try {
    const user = req.auth!;
    if (!(await deleteMaterial(user.id, req.params.id))) {
      res.status(404).json({ error: "Material not found" });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/concepts", async (req, res, next) => {
  try {
    res.json(await listConcepts(req.auth!.id));
  } catch (error) {
    next(error);
  }
});

router.post("/practice", async (req, res, next) => {
  try {
    const input = CreatePracticeBody.parse(req.body);
    const user = req.auth!;
    const session = await createPractice(user.id, {
      subjectId: input.subjectId ?? undefined,
      materialId: input.materialId ?? undefined,
      questionCount: input.questionCount,
      sessionType: "practice",
    });
    if (!session) {
      res.status(404).json({ error: "Subject or material not found" });
      return;
    }
    res.status(201).json(session);
  } catch (error) {
    next(error);
  }
});

router.post("/practice/weakness", async (req, res, next) => {
  try {
    const input = CreateWeaknessPracticeBody.parse(req.body);
    const user = req.auth!;
    const session = await createPractice(
      user.id,
      { questionCount: 6, sessionType: "weakness" },
      input.conceptIds,
    );
    if (!session) {
      res.status(404).json({ error: "Practice concepts not found" });
      return;
    }
    res.status(201).json(session);
  } catch (error) {
    next(error);
  }
});

router.get("/practice/:id", async (req, res, next) => {
  try {
    const user = req.auth!;
    const session = await getPractice(user.id, req.params.id);
    if (!session) {
      res.status(404).json({ error: "Practice session not found" });
      return;
    }
    res.json(session);
  } catch (error) {
    next(error);
  }
});

router.post("/practice/:id", async (req, res, next) => {
  try {
    const input = AnswerPracticeBody.parse(req.body);
    const user = req.auth!;
    const result = await answerPractice(user.id, req.params.id, input);
    if (result === undefined) {
      res.status(404).json({ error: "Practice session not found" });
      return;
    }
    if (result === null) {
      res.status(404).json({ error: "Question not found" });
      return;
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/practice/:id/complete", async (req, res, next) => {
  try {
    const result = await completePractice(req.auth!.id, req.params.id);
    if (!result) {
      res.status(404).json({ error: "Practice session not found" });
      return;
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/progress", async (req, res, next) => {
  try {
    const concepts = await listConcepts(req.auth!.id);
    res.json({
      overallMastery: concepts.length
        ? Math.round(
            concepts.reduce((total, concept) => total + concept.masteryScore, 0) /
              concepts.length,
          )
        : 0,
      changeThisWeek: 8,
      accuracy: 78,
      confidence: 69,
      studyMinutes: 184,
      questionsAnswered: concepts.reduce(
        (total, concept) => total + concept.questionsAttempted,
        0,
      ),
      weekly: [
        { day: "Mon", minutes: 24, questions: 8 },
        { day: "Tue", minutes: 12, questions: 5 },
        { day: "Wed", minutes: 31, questions: 11 },
        { day: "Thu", minutes: 18, questions: 7 },
        { day: "Fri", minutes: 38, questions: 10 },
        { day: "Sat", minutes: 19, questions: 7 },
        { day: "Sun", minutes: 42, questions: 12 },
      ],
      concepts,
    });
  } catch (error) {
    next(error);
  }
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

router.get("/subscription", async (req, res, next) => {
  try {
    res.json(await getSubscription(req.auth!.id));
  } catch (error) {
    next(error);
  }
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

export default router;