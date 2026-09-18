import { ERROR_CODES, isErrorCode } from "../api/errorCodes.js";
import multer from "multer";
import { AppError } from "../errors.js";
import { isDatabaseBusy } from "../db/transactions.js";

export function notFound(_req, _res, next) {
  next(new AppError(404, ERROR_CODES.NOT_FOUND, "The requested resource was not found."));
}

export function errorHandler(error, _req, res, _next) {
  let normalized = error;
  if (error instanceof multer.MulterError) {
    const messages = {
      LIMIT_FILE_SIZE: "Each document must be 2 MB or smaller.",
      LIMIT_FILE_COUNT: "Upload no more than 100 documents at once.",
      LIMIT_UNEXPECTED_FILE: "Use the files field to upload documents.",
    };
    normalized = new AppError(400, isErrorCode(error.code) ? error.code : ERROR_CODES.UPLOAD_FAILED, messages[error.code] || "The upload could not be accepted.");
  } else if (error.type === "entity.parse.failed") {
    normalized = new AppError(400, ERROR_CODES.INVALID_REQUEST_BODY, "The request body must contain valid JSON.");
  } else if (error.type === "entity.too.large") {
    normalized = new AppError(413, ERROR_CODES.REQUEST_TOO_LARGE, "The request body exceeds the allowed size.");
  } else if (isDatabaseBusy(error)) {
    normalized = new AppError(409, ERROR_CODES.DATABASE_WRITE_BUSY, "Another write is in progress. Wait and try again.");
  }
  const status = normalized instanceof AppError ? normalized.status : 500;
  const payload = {
    error: {
      code: normalized instanceof AppError && isErrorCode(normalized.code) ? normalized.code : ERROR_CODES.INTERNAL_ERROR,
      message: status === 500 ? "The server could not complete the request. Try again." : normalized.message,
    },
  };
  if (normalized instanceof AppError && normalized.details) payload.error.details = normalized.details;
  if (status === 500 && process.env.NODE_ENV !== "test") console.error(error);
  res.status(status).json(payload);
}

