const { ValidationError, ConflictError, ForbiddenError } = require("../errors");
const v = require("./workflow-input");
function transition(state, actor, body, students, members) {
  if (!members.includes(actor)) throw new ForbiddenError();
  const next = structuredClone(state);
  if (next.finalized) throw new ConflictError("Selection already finalized.");
  if (body.action === "propose") {
    if (next.proposal && next.proposal.status !== "rejected") throw new ConflictError("A proposal already exists.");
    const hasTotal = Object.hasOwn(body, 'total');
    const hasLegacy = Object.hasOwn(body, 'normal') || Object.hasOwn(body, 'special');
    if (hasTotal && (!Number.isInteger(body.total) || body.total < 1 || body.total > 999)) throw new ValidationError("Invalid capacity.");
    if (hasLegacy && (!Number.isInteger(body.normal) || !Number.isInteger(body.special) || body.normal < 0 || body.special < 0)) throw new ValidationError("Invalid capacity.");
    const total = hasTotal ? body.total : hasLegacy ? body.normal + body.special : null;
    if (!Number.isInteger(total) || total < 1 || total > 999 || hasTotal && hasLegacy && total !== body.normal + body.special) throw new ValidationError("Invalid capacity.");
    // Retain the legacy fields for readers of old proposal receipts. New UI
    // commands and ranking use total; these fields are not new track quotas.
    const normal = hasLegacy ? body.normal : total;
    const special = hasLegacy ? body.special : 0;
    const reason = v.text(body.reason, "reason", 2e3);
    next.proposal = {
      number: (next.proposal?.number || 0) + 1,
      total,
      normal,
      special,
      reason,
      proposer: actor,
      votes: Object.fromEntries(members.filter((x) => x !== actor).map((x) => [x, "pending"])),
      status: "pending",
      created: (new Date()).toISOString()
    };
  } else if (body.action === "accept" || body.action === "reject") {
    const p = next.proposal;
    if (!p || p.status !== "pending" || p.proposer === actor || p.votes[actor] !== "pending") throw new ConflictError("Proposal changed; refresh.");
    if (body.action === "reject") {
      p.rejection_reason = v.text(body.reason, "reason", 2e3);
      p.votes[actor] = "rejected";
      p.status = "rejected";
    } else {
      p.votes[actor] = "accepted";
      if (Object.values(p.votes).every((x) => x === "accepted")) p.status = "accepted";
    }
  } else if (body.action === "finalize") {
    if (next.proposal?.status !== "accepted") throw new ConflictError("Capacity needs both approvals.");
    if (!["core", "gpax"].includes(body.ranking)) throw new ValidationError("Invalid ranking.");
    if (!Array.isArray(body.selected) || !body.selected.length || new Set(body.selected).size !== body.selected.length || body.selected.some((id) => !students.some((s) => s.id === id))) throw new ValidationError("Invalid selection.");
    next.applicants = students.map((s) => ({ id: s.id, version: s.plan_version }));
    next.selected = body.selected;
    next.finalized = true;
    next.finalized_by = actor;
    next.ranking = body.ranking;
  } else throw new ValidationError("Unknown action.");
  next.history = [{ title: body.action, text: body.reason || "", actor, at: (new Date()).toISOString() }, ...next.history || []];
  return next;
}
module.exports = { transition };
