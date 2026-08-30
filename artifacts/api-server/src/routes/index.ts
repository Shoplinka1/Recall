import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import recallRouter from "./recall";
import storageRouter from "./storage";
import billingRouter from "./billing";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
  router.use("/storage", storageRouter);
router.use("/billing", billingRouter);
router.use("/admin", adminRouter);
router.use(recallRouter);

export default router;
