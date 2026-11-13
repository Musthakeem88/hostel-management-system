const logger = require("./logger");

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const bad = (message, extra) => new HttpError(400, message, extra);
const forbidden = (message = "You do not have permission to do that.") => new HttpError(403, message);
const notFound = (message = "Not found.") => new HttpError(404, message);
const conflict = (message) => new HttpError(409, message);

// 404 for unknown API paths
function apiNotFound(req, res) {
  res.status(404).json({ error: "API endpoint not found." });
}

// Single place that turns errors into JSON responses
function errorHandler(error, req, res, next) { // eslint-disable-line no-unused-vars
  if (res.headersSent) return next(error);

  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.message, ...(error.extra || {}) });
  }

  if (error && (error.type === "entity.parse.failed" || error instanceof SyntaxError)) {
    return res.status(400).json({ error: "Invalid JSON body." });
  }

  if (error && error.type === "entity.too.large") {
    return res.status(413).json({ error: "The request is too large." });
  }

  if (error && error.code === "23505") {
    return res.status(409).json({ error: "That record already exists (duplicate value)." });
  }

  if (error && (error.code === "23514" || error.code === "23502" || error.code === "22P02")) {
    return res.status(400).json({ error: "Some of the values are not valid." });
  }

  logger.error("Unhandled error", { path: req.path, method: req.method, message: error && error.message, stack: error && error.stack });
  res.status(500).json({ error: "Something went wrong on the server." });
}

module.exports = { HttpError, bad, forbidden, notFound, conflict, apiNotFound, errorHandler };
