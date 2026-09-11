// Wraps an async Express handler so a rejected promise is forwarded to
// next(err) - reaching server.js's error-handling middleware and giving
// the caller a real HTTP error response - instead of becoming an
// unhandled rejection that only the process-wide safety net in
// server.js catches (which keeps the server alive but leaves that one
// request hanging with no response).
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = asyncHandler;
