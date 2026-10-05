const prisma = require('../config/db');
const { AppError } = require('../utils/errorResponse');

// Settings a system administrator or HR Manager+ changes on the Settings
// page (settingsController). Each has a default (an environment variable
// where one existed before) and limits, so a typo can't, say, wipe data a
// week after it was collected. Rows exist only once someone has set them.

const DEFINITIONS = {
  candidateRetentionMonths: {
    label: 'Keep an unsuccessful candidate\'s data for (months)',
    help: 'After their last activity - their last sign-in or application. Then their personal data is erased by the scheduled purge. Hired candidates and anyone with an application still in progress are never purged.',
    default: () => 24, min: 6, max: 120
  },
  accessLogRetentionDays: {
    label: 'Keep the record of who viewed candidate data for (days)',
    help: 'Each view is recorded (the access log); older records are deleted by the scheduled purge.',
    default: () => {
      const env = Number(process.env.ACCESS_LOG_RETENTION_DAYS);
      return Number.isInteger(env) && env >= 90 ? env : 730;
    },
    min: 90, max: 3650
  }
};

function definition(key) {
  const def = DEFINITIONS[key];
  if (!def) throw new AppError('No such setting', 404);
  return def;
}

async function get(key) {
  const def = definition(key);
  const row = await prisma.setting.findUnique({ where: { key } });
  const value = row ? Number(row.value) : NaN;
  return Number.isInteger(value) && value >= def.min && value <= def.max ? value : def.default();
}

async function list() {
  const rows = await prisma.setting.findMany({ include: { updatedBy: { select: { id: true, name: true } } } });
  return Promise.all(Object.entries(DEFINITIONS).map(async ([key, def]) => {
    const row = rows.find((r) => r.key === key);
    return {
      key, label: def.label, help: def.help, min: def.min, max: def.max, default: def.default(),
      value: await get(key), updatedAt: row?.updatedAt || null, updatedBy: row?.updatedBy || null
    };
  }));
}

async function set(key, input, staffId) {
  const def = definition(key);
  const value = Number(input);
  if (!Number.isInteger(value) || value < def.min || value > def.max) {
    throw new AppError(`${def.label}: enter a whole number from ${def.min} to ${def.max}`, 400);
  }
  const before = await get(key);
  await prisma.setting.upsert({ where: { key }, create: { key, value, updatedById: staffId }, update: { value, updatedById: staffId } });
  return { before, after: value };
}

module.exports = { get, list, set, DEFINITIONS };
