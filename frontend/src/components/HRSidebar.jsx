import React from 'react';
import { Inbox, Briefcase, Users, CalendarClock, Award, BarChart3, Network, FileSignature, Share2, Settings, UserCog } from 'lucide-react';
import Sidebar from './Sidebar';
import { useAuth } from '../models/AuthContext';
import { useInbox } from '../models/useInbox';

// Matches backend/src/middleware/auth.js's 5-tier ROLE_RANK.
const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };

// The staff workspace's one navigation, the same shape for every role:
//   My work     - the Inbox: what is waiting for this person (inboxService)
//   Recruitment - vacancies (each with its own workspace), candidates,
//                 interviews, offers & hires
//   Reports     - the recruitment dashboard (Manager+, as its API is)
//   Setup       - organisation, templates, delegations, settings, accounts
// Items a role can't use are left out rather than shown and refused. An
// accounts-only system administrator (no HR role) sees only Setup.
//
// `active` is the key of the current page; the old keys some pages still
// pass map onto the new items.
const ACTIVE_ALIASES = {
  home: 'inbox', executive: 'inbox', approvals: 'inbox',
  applications: 'candidates', analytics: 'dashboard', departments: 'organisation', 'staff-management': 'delegations'
};

export default function HRSidebar({ active }) {
  const { staff } = useAuth();
  const rank = ROLE_RANK[staff?.role] || 0;
  const inbox = useInbox({ enabled: Boolean(staff?.role) });
  const items = inbox?.items || [];
  const actionable = items.filter((i) => !i.info);
  const overdue = actionable.some((i) => i.overdue);

  const setup = [
    staff?.role && { key: 'organisation', label: 'Organisation', icon: Network, to: '/hr/departments', section: 'Setup' },
    staff?.role && { key: 'templates', label: 'Document templates', icon: FileSignature, to: '/hr/templates', section: 'Setup' },
    rank >= ROLE_RANK.Senior_HR_Officer && { key: 'delegations', label: 'Delegations', icon: Share2, to: '/hr/staff-management', section: 'Setup' },
    (staff?.isSystemAdmin || rank >= ROLE_RANK.Manager) && { key: 'settings', label: 'Settings & data', icon: Settings, to: '/hr/settings', section: 'Setup' },
    staff?.isSystemAdmin && { key: 'staff-accounts', label: 'Staff accounts', icon: UserCog, to: '/hr/staff-accounts', section: 'Setup' }
  ].filter(Boolean);

  const list = !staff?.role ? setup : [
    { key: 'inbox', label: 'Inbox', icon: Inbox, to: '/hr/inbox', section: 'My work', badge: actionable.length, badgeTone: overdue ? 'alert' : 'count' },
    { key: 'vacancies', label: 'Vacancies', icon: Briefcase, to: '/hr', section: 'Recruitment' },
    { key: 'candidates', label: 'Candidates', icon: Users, to: '/hr/candidates', section: 'Recruitment' },
    { key: 'interviews', label: 'Interviews', icon: CalendarClock, to: '/hr/interviews', section: 'Recruitment' },
    { key: 'offers', label: 'Offers & hires', icon: Award, to: '/hr/offers', section: 'Recruitment' },
    ...(rank >= ROLE_RANK.Manager ? [{ key: 'dashboard', label: 'Dashboard', icon: BarChart3, to: '/hr/dashboard', section: 'Reports' }] : []),
    ...setup
  ];

  const acting = inbox?.delegation?.actingFor;
  const delegated = inbox?.delegation?.delegatedTo;
  const until = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const footer = acting || delegated ? (
    <div className="ws-acting">
      <b>Delegation</b><br />
      {acting && <>You act for {acting.name} until {until(acting.until)}.</>}
      {acting && delegated && <br />}
      {delegated && <>{delegated.name} acts for you until {until(delegated.until)}.</>}
    </div>
  ) : null;

  return <Sidebar items={list} active={ACTIVE_ALIASES[active] || active} storageKey="hrSidebarCollapsed" width={236} title="Menu" variant="rail" mobileTrigger={false} footer={footer} />;
}
