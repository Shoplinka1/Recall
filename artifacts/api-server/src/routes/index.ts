import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import recallRouter from "./recall";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use(storageRouter);
router.use(recallRouter);

export default router;
