export const SCREENS = [
  { id: 'dashboard', label: 'Dashboard', kicker: 'Reporting', title: 'Funnel and outcomes' },
  { id: 'crm', label: 'Attendee CRM', kicker: 'People', title: 'Attendee CRM' },
  { id: 'scheduling', label: 'Scheduling', kicker: 'Consultations', title: 'Scheduling and appointments' },
  { id: 'outcome', label: 'Outcome form', kicker: 'Field Staff Member', title: 'Post-interview outcome' },
  { id: 'nurture', label: 'Nurture journeys', kicker: 'Automation', title: 'Nurture journeys' },
  { id: 'lists', label: 'Division 6 lists', kicker: 'Data intake', title: 'Division 6 public lists' },
  { id: 'training', label: 'Training library', kicker: 'Hats and qualification', title: 'Training library' },
  { id: 'recruitment', label: 'Recruitment', kicker: 'Field activation', title: 'Recruitment funnel' },
  { id: 'stories', label: 'Success line', kicker: 'Stories and consent', title: 'Success story pipeline' },
  { id: 'admin', label: 'Platform admin', kicker: 'Governance', title: 'Organizations and integration' },
];

export const ROLE_SCREENS = {
  fsm: ['dashboard', 'crm', 'scheduling', 'outcome', 'training'],
  manager: ['dashboard', 'crm', 'scheduling', 'nurture', 'lists', 'training', 'recruitment', 'stories'],
  admin: SCREENS.map((s) => s.id),
};

export const ROLES = [
  { id: 'fsm', label: 'FSM', name: 'D. Whitfield', initials: 'DW', full: 'Field Staff Member' },
  { id: 'manager', label: 'Host', name: 'A. Reyes', initials: 'AR', full: 'Campaign manager / host' },
  { id: 'admin', label: 'Admin', name: 'M. Okafor', initials: 'MO', full: 'Platform administrator' },
];

export const ROLES_TABLE = [
  ['Platform administrator', 'All organizations', 'Full system access; audited'],
  ['Church administrator', 'Own Church', 'Lists, campaigns, users, reports'],
  ['Campaign manager / host', 'Own Church', 'Events, attendees, nurture, scheduling'],
  ['Field Staff Member', 'Assigned contacts', 'Availability, outcome forms, training'],
  ['Field disseminator', 'Limited', 'Orientation & referral materials only'],
  ['Trainer / qual supervisor', 'Training domain', 'Content, assessments, sign-off'],
  ['Success-line staff', 'Stories', 'Intake, consent, editorial pipeline'],
  ['Read-only executive', 'Authorized orgs', 'Dashboards only; no edits'],
];
