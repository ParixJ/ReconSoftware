import multer from "multer";
import { AppError } from "../errors.js";

export function notFound(_req, _res, next) {
  next(new AppError(404, "NOT_FOUND", "The requested resource was not found."));
}

export function errorHandler(error, _req, res, _next) {
  let normalized = error;
  if (error instanceof multer.MulterError) {
    const messages = {
      LIMIT_FILE_SIZE: "Each document must be 2 MB or smaller.",
      LIMIT_FILE_COUNT: "Upload no more than 100 documents at once.",
      LIMIT_UNEXPECTED_FILE: "Use the files field to upload documents.",
    };
    normalized = new AppError(400, error.code, messages[error.code] || "The upload could not be accepted.");
  }
  const status = normalized instanceof AppError ? normalized.status : 500;
  const payload = {
    error: {
      code: normalized.code || "INTERNAL_ERROR",
      message: status === 500 ? "The server could not complete the request. Try again." : normalized.message,
    },
  };
  if (normalized.details) payload.error.details = normalized.details;
  if (status === 500 && process.env.NODE_ENV !== "test") console.error(error);
  res.status(status).json(payload);
}

