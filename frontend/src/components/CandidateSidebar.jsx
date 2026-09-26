import React from 'react';
import { Home, Search, FileText, User } from 'lucide-react';
import Sidebar from './Sidebar';

// Shared across every /dashboard/* screen, mirroring HRSidebar's pattern
// for the staff side of the app. Four stops instead of the previous two:
// Home is now a real overview (stats + shortcuts) rather than also
// carrying the full job listing, so browsing/searching vacancies gets its
// own "Find Jobs" stop (CandidateJobs.jsx) and profile editing gets its
// own "My Profile" stop (CandidateProfile.jsx, moved off the top of the
// Applications page so that page can focus on tracking applications).
// Grouped ("Opportunities" for browsing/tracking, "Account" for profile
// editing) mirroring HRSidebar's section pattern, for the same reason:
// it separates "look for/track work" from "manage my own info" at a
// glance instead of one undifferentiated list.
const ITEMS = [
  { key: 'home', label: 'Home', icon: Home, to: '/dashboard' },
  { key: 'jobs', label: 'Find Jobs', icon: Search, to: '/dashboard/jobs', section: 'Opportunities' },
  { key: 'applications', label: 'My Applications', icon: FileText, to: '/dashboard/applications', section: 'Opportunities' },
  { key: 'profile', label: 'My Profile', icon: User, to: '/dashboard/profile', section: 'Account' },
];

export default function CandidateSidebar({ active }) {
  return <Sidebar items={ITEMS} active={active} storageKey="candidateSidebarCollapsed" width={220} title="Candidate Portal" />;
}
