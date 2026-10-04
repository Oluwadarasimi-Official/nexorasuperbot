'use strict';

/**
 * Structured JSON logging. Never log message contents or secrets here —
 * callers pass only metadata (command, user id, timings, outcome).
 */
function logEvent(event, fields = {}) {
  const line = { ts: new Date().toISOString(), event, ...fields };
  try {
    console.log(JSON.stringify(line));
  } catch {
    console.log('[log]', event);
  }
}

function redactUser(id) {
  return 'u_' + String(id);
}

module.exports = { logEvent, redactUser };
