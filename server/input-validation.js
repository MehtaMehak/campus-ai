// Limits mirror setup-db.js. PostgreSQL VARCHAR counts Unicode characters,
// not UTF-16 code units. TEXT fields intentionally have no artificial cap.
const limits = {
  signup: { name: 100, email: 150 },
  login: { email: 150 },
  notes: { title: 200 },
  assignments: { title: 200 },
  tasks: { title: 200 },
  resources: { title: 200 },
};
const assignmentStatuses = ["Pending", "In Progress", "Completed"];
const taskStatuses = ["Pending", "Completed"];
const taskPriorities = ["Low", "Medium", "High"];

function validateInput(kind) {
  return (req, res, next) => {
    const body = req.body || {};
    for (const [field, max] of Object.entries(limits[kind])) {
      if (typeof body[field] === "string") {
        const value = field === "email" ? body[field].trim().toLowerCase() : body[field].trim();
        if ([...value].length > max) {
          return res.status(400).json({ error: `${field} must be at most ${max} characters` });
        }
      }
    }
    const enums = kind === "assignments" ? { status: assignmentStatuses }
      : kind === "tasks" ? { status: taskStatuses, priority: taskPriorities } : {};
    for (const [field, allowed] of Object.entries(enums)) {
      if (body[field] !== undefined) {
        if (typeof body[field] !== "string" || !allowed.includes(body[field].trim())) {
          return res.status(400).json({ error: `${field} must be one of ${allowed.join(", ")}` });
        }
        body[field] = body[field].trim();
      }
    }
    next();
  };
}

module.exports = { validateInput };
