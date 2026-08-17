export function fsmModules(db, orgId) {
  return db.prepare(`
    SELECT id FROM training_modules WHERE org_id = ? AND track = 'FSM' ORDER BY sort_order, id
  `).all(orgId);
}

export function routingGate(db, orgId, userId) {
  if (userId == null) {
    return { routingEnabled: false, reason: 'no_user', complete: 0, required: 0, signedOff: false };
  }
  const modules = fsmModules(db, orgId);
  const required = modules.length;
  let complete = 0;
  for (const mod of modules) {
    const row = db.prepare(`
      SELECT status, progress_pct FROM training_progress
       WHERE org_id = ? AND user_id = ? AND module_id = ?
    `).get(orgId, userId, mod.id);
    if (row && (row.status === 'complete' || Number(row.progress_pct) >= 100)) complete += 1;
  }
  const signoff = db.prepare(`
    SELECT id FROM signoffs WHERE org_id = ? AND user_id = ? AND track = 'FSM' LIMIT 1
  `).get(orgId, userId);
  const signedOff = Boolean(signoff);
  const routingEnabled = required > 0 && complete === required && signedOff;
  let reason = 'ready';
  if (!routingEnabled) {
    reason = complete < required ? 'track_incomplete' : 'signoff_pending';
  }
  return { routingEnabled, reason, complete, required, signedOff };
}

export function assertRoutingAllowed(db, orgId, fsmUserId) {
  const gate = routingGate(db, orgId, fsmUserId);
  if (gate.routingEnabled) return null;
  return {
    code: 'routing_gated',
    message: gate.reason === 'signoff_pending'
      ? 'Appointment routing is withheld until a supervisor signs off the FSM track.'
      : 'Appointment routing is withheld until the FSM track is complete.',
    gate,
  };
}
