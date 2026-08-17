import { Router, type IRouter } from "express";
import healthRouter from "./health";
import recallRouter from "./recall";

const router: IRouter = Router();

router.use(healthRouter);
router.use(recallRouter);

export default router;
