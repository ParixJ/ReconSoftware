import { CLIENT_ERROR_CODES, ERROR_CODES, isErrorCode } from "../../../shared/errorCodes.js";

export { CLIENT_ERROR_CODES, ERROR_CODES };

// Server codes take precedence over Axios transport codes.
export function errorCode(error) {
  const code = error?.response?.data?.error?.code;
  if (isErrorCode(code)) return code;
  if (error?.response) return CLIENT_ERROR_CODES.REQUEST_FAILED;
  if (error?.code === "ERR_CANCELED") return CLIENT_ERROR_CODES.REQUEST_CANCELLED;
  if (["ECONNABORTED", "ETIMEDOUT"].includes(error?.code)) return CLIENT_ERROR_CODES.REQUEST_TIMEOUT;
  if (error?.code === "ERR_NETWORK" || error?.request) return CLIENT_ERROR_CODES.NETWORK_ERROR;
  return CLIENT_ERROR_CODES.REQUEST_FAILED;
}

export function errorMessage(error, fallback = "The request could not be completed.") {
  return error?.response?.data?.error?.message || error?.message || fallback;
}
