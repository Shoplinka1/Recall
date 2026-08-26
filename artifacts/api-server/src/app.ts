import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { ObjectStorageConfigurationError } from "./lib/object-storage";
import { RecallLimitError } from "./lib/recall-store";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
app.use(
  express.json({
    verify(req, _res, buffer) {
      (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
    },
  }),
);
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err: error }, "Unhandled request error");
  if (res.headersSent) return;
  if (error instanceof ObjectStorageConfigurationError) {
    res.status(503).json({ error: error.message });
    return;
  }
  if (error instanceof RecallLimitError) {
    res.status(402).json({ error: error.message, code: "FREE_LIMIT_REACHED", resource: error.resource, limit: error.limit });
    return;
  }
  if (error && typeof error === "object" && "issues" in error) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  res.status(500).json({ error: "An unexpected error occurred" });
});

export default app;
