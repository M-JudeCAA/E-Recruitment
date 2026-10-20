const staffModel = require('../models/staffModel');
const directory = require('./directoryService');
const audit = require('./auditService');
const { notify } = require('./notificationService');
const { sendMail } = require('../utils/mailer');
const { staffFrontendUrl } = require('../config/frontendUrl');
const { escapeHtml } = require('../utils/interviewFormat');

// The staff app's Entra security group (ENTRA_STAFF_GROUP_ID): the group an
// Entra administrator assigned to the staff app, so its members may open it.
// Creating a staff account adds the person to it, deactivating removes them,
// reactivating adds them back - so a system administrator never has to ask
// the Entra administrator. Being in the group still grants nothing here: the
// StaffUser row and its role decide that.
//
// The directory app holds no Graph permission for this. An Entra
// administrator gives it a role scoped to an administrative unit that holds
// only this group (docs/entra-staff-group-setup.md), so it can change this
// group's members and nothing else.
//
// Never throws: a Microsoft problem must not undo the account change. A
// failure is kept on the account (Failed + the reason, Retry on Staff
// accounts), audited, and told to the system administrators once.

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const groupId = () => String(process.env.ENTRA_STAFF_GROUP_ID || '').trim();

function isConfigured() {
  return directory.isConfigured() && GUID_RE.test(groupId());
}

// What a system administrator can act on - never Graph's own error text.
function reasonFor(err) {
  if (err.code === 'NOT_IN_DIRECTORY') return 'This person was not found in the UCAA directory.';
  if (err.status === 401 || err.status === 403) {
    return "Microsoft Entra refused the change - the e-Recruitment app's role over the staff group's administrative unit is missing or doesn't cover this group.";
  }
  if (err.status === 404) return "The staff app's group was not found in Microsoft Entra - check ENTRA_STAFF_GROUP_ID.";
  return 'Microsoft Entra could not be reached just now.';
}

function welcomeEmail(staff) {
  const what = [
    staff.role ? staff.role.replace(/_/g, ' ') : null,
    staff.isSystemAdmin ? 'system administrator' : null
  ].filter(Boolean).join(' and ');
  return {
    to: staff.email,
    subject: 'Your UCAA e-Recruitment staff account',
    html: `<p>Hi ${escapeHtml(staff.name)},</p><p>A staff account has been created for you on the UCAA e-Recruitment system, as ${escapeHtml(what)}.</p>`
      + `<p>Sign in with your UCAA Microsoft account (${escapeHtml(staff.email)}) at <a href="${staffFrontendUrl}/staff/login">${staffFrontendUrl}/staff/login</a>. There is no separate password.</p>`
  };
}

async function tellAdmins(staff, wantInGroup, reason) {
  const admins = await staffModel.findActiveAdmins();
  const message = `${staff.name} (${staff.email}) could not be ${wantInGroup ? 'added to' : 'removed from'} the staff app's group in Microsoft Entra: ${reason} `
    + (wantInGroup ? 'Until then they cannot open the staff portal. ' : 'Until then the staff portal still shows in their Microsoft apps, though their account here is deactivated. ')
    + 'Open Staff accounts to retry.';
  for (const admin of admins) {
    await notify(admin.id, 'StaffGroupSyncFailed', staff.id, message, {
      link: '/hr/staff-accounts', subject: 'Staff app access needs attention'
    }).catch((err) => console.error('Staff group failure notice not sent:', err.message));
  }
}

/**
 * Puts the account where it belongs in the staff app's group: in it while
 * active, out of it once deactivated. Records the outcome on the account.
 * Returns { configured, state, error } - state InGroup / NotInGroup / Failed.
 * `welcome`: email the person their sign-in details once they are in.
 */
async function sync(staff, { req, welcome = false } = {}) {
  if (!isConfigured()) return { configured: false, state: staff.entraGroupState || null, error: null };
  const wantInGroup = Boolean(staff.active);
  const actor = req ? audit.actorFrom(req) : undefined;

  try {
    const userId = staff.entraObjectId || await directory.findUserIdByEmail(staff.email);
    if (!userId) throw Object.assign(new Error('not in directory'), { code: 'NOT_IN_DIRECTORY' });
    if (wantInGroup) await directory.addGroupMember(groupId(), userId);
    else await directory.removeGroupMember(groupId(), userId);
  } catch (err) {
    console.error(`Staff group ${wantInGroup ? 'add' : 'remove'} failed for staff ${staff.id}:`, err.message);
    const reason = reasonFor(err);
    await staffModel.update(staff.id, { entraGroupState: 'Failed', entraGroupError: reason, entraGroupCheckedAt: new Date() });
    await audit.record({
      entityType: 'StaffUser', entityId: staff.id, actor,
      action: wantInGroup ? 'Adding to staff app group failed' : 'Removing from staff app group failed', comment: reason
    });
    // Once per failure, not on every retry that fails the same way.
    if (staff.entraGroupState !== 'Failed') await tellAdmins(staff, wantInGroup, reason);
    return { configured: true, state: 'Failed', error: reason };
  }

  const state = wantInGroup ? 'InGroup' : 'NotInGroup';
  await staffModel.update(staff.id, { entraGroupState: state, entraGroupError: null, entraGroupCheckedAt: new Date() });
  if (staff.entraGroupState !== state) {
    await audit.record({
      entityType: 'StaffUser', entityId: staff.id, actor,
      action: wantInGroup ? 'Added to staff app group' : 'Removed from staff app group'
    });
  }
  // The sign-in email goes once they can actually sign in: at creation, or
  // when a retry finally gets a new account into the group.
  if (wantInGroup && (welcome || (staff.entraGroupState === 'Failed' && !staff.lastLoginAt))) {
    await sendMail(welcomeEmail(staff));
  }
  return { configured: true, state, error: null };
}

module.exports = { isConfigured, sync, welcomeEmail, reasonFor, groupId };
