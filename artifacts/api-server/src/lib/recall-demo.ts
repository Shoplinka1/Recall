import { randomUUID } from "node:crypto";
import type {
  AnswerInput,
  Concept,
  Dashboard,
  Material,
  Mistake,
  PracticeResults,
  PracticeSession,
  Progress,
  Question,
  Recommendation,
  Subject,
  Subscription,
} from "@workspace/api-zod";

export type DemoAnswer = AnswerInput & {
  isCorrect: boolean;
  question: Question;
};

export type DemoSession = PracticeSession & {
  answers: DemoAnswer[];
};

export const demoSubjects: Subject[] = [
  {
    id: "subject-anatomy",
    name: "Human Anatomy",
    description: "Structures, systems, and the signals that keep the body moving.",
    color: "violet",
    materialCount: 3,
  },
  {
    id: "subject-biology",
    name: "Cell Biology",
    description: "The machinery of life, from membranes to protein synthesis.",
    color: "teal",
    materialCount: 2,
  },
  {
    id: "subject-physics",
    name: "Physics",
    description: "Build intuition for motion, energy, and the forces between them.",
    color: "amber",
    materialCount: 1,
  },
];

export const demoMaterials: Material[] = [
  {
    id: "material-cardiovascular",
    title: "Cardiovascular System",
    subjectId: "subject-anatomy",
    subjectName: "Human Anatomy",
    fileType: "PDF",
    processingStatus: "ready",
    concepts: 8,
    sessions: 4,
    lastStudied: "2026-08-15T14:30:00.000Z",
    createdAt: "2026-08-08T09:15:00.000Z",
    excerpt:
      "The heart is a muscular pump with four chambers. The sinoatrial node initiates the electrical impulse that coordinates contraction.",
  },
  {
    id: "material-cell-membranes",
    title: "Cell Membranes & Transport",
    subjectId: "subject-biology",
    subjectName: "Cell Biology",
    fileType: "DOCX",
    processingStatus: "ready",
    concepts: 6,
    sessions: 2,
    lastStudied: "2026-08-12T18:05:00.000Z",
    createdAt: "2026-08-03T11:40:00.000Z",
    excerpt:
      "The phospholipid bilayer creates a selectively permeable boundary. Transport may be passive or require energy.",
  },
  {
    id: "material-neuro",
    title: "Neural Signaling Notes",
    subjectId: "subject-anatomy",
    subjectName: "Human Anatomy",
    fileType: "Pasted notes",
    processingStatus: "ready",
    concepts: 5,
    sessions: 1,
    lastStudied: null,
    createdAt: "2026-07-30T16:10:00.000Z",
    excerpt:
      "Neurons communicate through changes in membrane potential and the release of neurotransmitters at synapses.",
  },
];

export const demoConcepts: Concept[] = [
  {
    id: "concept-conduction",
    name: "Cardiac conduction",
    subjectId: "subject-anatomy",
    subjectName: "Human Anatomy",
    masteryScore: 48,
    status: "weak",
    questionsAttempted: 9,
    lastPracticed: "2026-08-15T14:30:00.000Z",
    sourceMaterial: "Cardiovascular System",
  },
  {
    id: "concept-heart-anatomy",
    name: "Heart anatomy",
    subjectId: "subject-anatomy",
    subjectName: "Human Anatomy",
    masteryScore: 82,
    status: "strong",
    questionsAttempted: 12,
    lastPracticed: "2026-08-15T14:30:00.000Z",
    sourceMaterial: "Cardiovascular System",
  },
  {
    id: "concept-transport",
    name: "Membrane transport",
    subjectId: "subject-biology",
    subjectName: "Cell Biology",
    masteryScore: 61,
    status: "needs work",
    questionsAttempted: 8,
    lastPracticed: "2026-08-12T18:05:00.000Z",
    sourceMaterial: "Cell Membranes & Transport",
  },
  {
    id: "concept-osmosis",
    name: "Osmosis",
    subjectId: "subject-biology",
    subjectName: "Cell Biology",
    masteryScore: 74,
    status: "needs work",
    questionsAttempted: 7,
    lastPracticed: "2026-08-12T18:05:00.000Z",
    sourceMaterial: "Cell Membranes & Transport",
  },
  {
    id: "concept-neural",
    name: "Neural signaling",
    subjectId: "subject-anatomy",
    subjectName: "Human Anatomy",
    masteryScore: 91,
    status: "strong",
    questionsAttempted: 15,
    lastPracticed: "2026-08-10T12:15:00.000Z",
    sourceMaterial: "Neural Signaling Notes",
  },
  {
    id: "concept-kinematics",
    name: "Kinematics",
    subjectId: "subject-physics",
    subjectName: "Physics",
    masteryScore: 57,
    status: "needs work",
    questionsAttempted: 5,
    lastPracticed: null,
    sourceMaterial: "Motion & Forces",
  },
];

export const demoQuestions: Question[] = [
  {
    id: "question-sa-node",
    questionText: "What is the primary role of the sinoatrial node?",
    type: "multiple_choice",
    options: [
      "It initiates the electrical impulse for the heartbeat",
      "It pumps oxygenated blood into the aorta",
      "It closes the atrioventricular valve",
      "It exchanges gases in the lungs",
    ],
    concept: "Cardiac conduction",
    difficulty: "medium",
    sourceExcerpt:
      "The sinoatrial node initiates the electrical impulse that coordinates contraction.",
    sourcePage: 12,
    explanation:
      "The sinoatrial node acts as the heart's natural pacemaker. It starts the electrical signal that spreads through the atria.",
    correctAnswer: "It initiates the electrical impulse for the heartbeat",
  },
  {
    id: "question-av-node",
    questionText:
      "Why is a short delay at the atrioventricular node useful?",
    type: "multiple_choice",
    options: [
      "It allows the ventricles time to fill after the atria contract",
      "It prevents all electrical activity in the ventricles",
      "It sends blood directly to the lungs",
      "It makes the heart beat only during exercise",
    ],
    concept: "Cardiac conduction",
    difficulty: "hard",
    sourceExcerpt:
      "A brief delay at the atrioventricular node gives the ventricles time to fill before they contract.",
    sourcePage: 13,
    explanation:
      "The delay coordinates the sequence of contraction: atria first, then ventricles.",
    correctAnswer: "It allows the ventricles time to fill after the atria contract",
  },
  {
    id: "question-osmosis",
    questionText:
      "In osmosis, water moves across a selectively permeable membrane toward the side with:",
    type: "multiple_choice",
    options: [
      "Higher solute concentration",
      "Lower solute concentration",
      "No solutes at all",
      "The higher temperature",
    ],
    concept: "Osmosis",
    difficulty: "medium",
    sourceExcerpt:
      "During osmosis, water moves toward the side of the membrane with the higher solute concentration.",
    sourcePage: 4,
    explanation:
      "Water moves down its own concentration gradient, which means toward the more concentrated solution.",
    correctAnswer: "Higher solute concentration",
  },
  {
    id: "question-active-transport",
    questionText:
      "What distinguishes active transport from simple diffusion?",
    type: "multiple_choice",
    options: [
      "Active transport requires cellular energy",
      "Active transport can only move water",
      "Active transport never uses membrane proteins",
      "Active transport always moves particles down their gradient",
    ],
    concept: "Membrane transport",
    difficulty: "easy",
    sourceExcerpt:
      "Active transport uses cellular energy to move substances against their concentration gradient.",
    sourcePage: 6,
    explanation:
      "Unlike simple diffusion, active transport can move a substance against its concentration gradient and requires energy.",
    correctAnswer: "Active transport requires cellular energy",
  },
  {
    id: "question-neuron",
    questionText: "What happens at a chemical synapse?",
    type: "multiple_choice",
    options: [
      "Neurotransmitters are released to carry the signal across the gap",
      "The two neurons permanently fuse together",
      "The receiving neuron stops all membrane activity",
      "Blood cells carry the signal between neurons",
    ],
    concept: "Neural signaling",
    difficulty: "medium",
    sourceExcerpt:
      "Neurons communicate through the release of neurotransmitters at synapses.",
    sourcePage: 8,
    explanation:
      "A presynaptic neuron releases neurotransmitters into the synaptic cleft, where they bind receptors on the next cell.",
    correctAnswer: "Neurotransmitters are released to carry the signal across the gap",
  },
  {
    id: "question-velocity",
    questionText:
      "If an object's velocity changes from 4 m/s to 10 m/s in 3 seconds, what is its average acceleration?",
    type: "multiple_choice",
    options: ["2 m/s²", "3 m/s²", "6 m/s²", "14 m/s²"],
    concept: "Kinematics",
    difficulty: "medium",
    sourceExcerpt:
      "Average acceleration is the change in velocity divided by the time interval.",
    sourcePage: 2,
    explanation:
      "Average acceleration is (10 − 4) / 3 = 2 m/s².",
    correctAnswer: "2 m/s²",
  },
];

export const demoMistakes: Mistake[] = [
  {
    id: "mistake-1",
    question: "In osmosis, water moves across a selectively permeable membrane toward the side with:",
    userAnswer: "Lower solute concentration",
    correctAnswer: "Higher solute concentration",
    explanation:
      "Water moves toward the more concentrated solution. Remember: water follows solute.",
    concept: "Osmosis",
    sourceExcerpt:
      "During osmosis, water moves toward the side of the membrane with the higher solute concentration.",
    confidence: "Very sure",
  },
  {
    id: "mistake-2",
    question: "What distinguishes active transport from simple diffusion?",
    userAnswer: "Active transport always moves particles down their gradient",
    correctAnswer: "Active transport requires cellular energy",
    explanation:
      "Active transport is defined by its use of energy to move substances against a gradient.",
    concept: "Membrane transport",
    sourceExcerpt:
      "Active transport uses cellular energy to move substances against their concentration gradient.",
    confidence: "Somewhat sure",
  },
];

export const practiceSessions = new Map<string, DemoSession>();
export const resultStore = new Map<string, PracticeResults>();

export const recommendation: Recommendation = {
  id: "rec-conduction",
  title: "Practice cardiac conduction",
  reason:
    "You missed 4 of your last 7 questions on this concept, and two misses were high-confidence answers.",
  concept: "Cardiac conduction",
  recommendedMinutes: 10,
  questionCount: 6,
  difficulty: "easy_to_medium",
  action: "weakness",
};

export const subscription: Subscription = {
  plan: "free",
  status: "active",
  sessionsUsed: 3,
  sessionsLimit: 5,
  materialsUsed: 3,
  materialsLimit: 5,
  resetDate: "2026-09-01",
};

export const buildDashboard = (): Dashboard => ({
  greeting: "Good morning, Alex",
  subtitle: "Your next best session is already waiting.",
  recommendation,
  stats: {
    weeklyMinutes: 42,
    weeklyGoal: 60,
    streak: 6,
    questionsAnswered: 48,
    overallMastery: 72,
  },
  recentMaterials: demoMaterials.slice(0, 3),
  concepts: [...demoConcepts].sort((a, b) => a.masteryScore - b.masteryScore),
});

export const buildProgress = (): Progress => ({
  overallMastery: 72,
  changeThisWeek: 8,
  accuracy: 78,
  confidence: 69,
  studyMinutes: 184,
  questionsAnswered: 48,
  weekly: [
    { day: "Mon", minutes: 24, questions: 8 },
    { day: "Tue", minutes: 12, questions: 5 },
    { day: "Wed", minutes: 31, questions: 11 },
    { day: "Thu", minutes: 18, questions: 7 },
    { day: "Fri", minutes: 38, questions: 10 },
    { day: "Sat", minutes: 19, questions: 7 },
    { day: "Sun", minutes: 42, questions: 12 },
  ],
  concepts: demoConcepts,
});

export const createDemoSession = (
  title: string,
  sessionType: string,
  subjectName: string,
  questions: Question[],
): DemoSession => {
  const session: DemoSession = {
    id: randomUUID(),
    title,
    sessionType,
    subjectName,
    questions,
    currentIndex: 0,
    completed: false,
    answers: [],
  };
  practiceSessions.set(session.id, session);
  return session;
};
