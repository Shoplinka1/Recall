import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { requestPrivateUpload } from "../lib/object-storage";

const router: IRouter = Router();
router.use(requireAuth);

router.post("/uploads/request-url", async (req, res, next) => {
  try {
    const { name, size, contentType } = req.body ?? {};
    if (
      typeof name !== "string" ||
      !name.trim() ||
      !Number.isInteger(size) ||
      size <= 0 ||
      size > 25 * 1024 * 1024 ||
      typeof contentType !== "string"
    ) {
      res.status(400).json({ error: "Invalid upload metadata" });
      return;
    }
    res.json(
      await requestPrivateUpload({
        ownerId: req.auth!.id,
        name: name.trim(),
        size,
        contentType,
      }),
    );
  } catch (error) {
    next(error);
  }
});

export default router;