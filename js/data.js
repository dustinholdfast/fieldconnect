// Sample data extracted from the FieldConnect design prototype

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
  { id: 'admin', label: 'Platform admin', kicker: 'Governance', title: 'Organizations and integration' }
];

export const ROLE_SCREENS = {
  fsm: ['dashboard', 'crm', 'scheduling', 'outcome', 'training'],
  manager: ['dashboard', 'crm', 'scheduling', 'nurture', 'lists', 'training', 'recruitment', 'stories'],
  admin: SCREENS.map(s => s.id)
};

export const ROLES = [
  { id: 'fsm', label: 'FSM', name: 'D. Whitfield', initials: 'DW', full: 'Field Staff Member' },
  { id: 'manager', label: 'Host', name: 'A. Reyes', initials: 'AR', full: 'Campaign manager / host' },
  { id: 'admin', label: 'Admin', name: 'M. Okafor', initials: 'MO', full: 'Platform administrator' }
];

export const CONTACTS = [
  {
    name: 'Karen Iversen', email: 'k.iversen@mail.com', phone: '+1 612 555 0148',
    source: 'Meetup', event: 'Dianetics #47', stage: 'Scheduled', consent: 'Email, SMS',
    fsm: 'D. Whitfield', ruin: 'Stress & anxiety — “constantly wound up at work”', journey: 'Pre-interview',
    history: [
      ['18 Aug', 'Registered from Meetup listing (campaign mtp-47)'],
      ['21 Aug', 'Attended lecture — 41 of 55 minutes'],
      ['21 Aug', 'Marked consultation interest; scheduling link sent'],
      ['22 Aug', 'Booked 27 Aug 6:30 PM CT with D. Whitfield'],
      ['22 Aug', 'Confirmation + “How the consultation works” sent']
    ]
  },
  {
    name: 'Marcus Bell', email: 'mbell@workmail.net', phone: '+1 651 555 0192',
    source: 'Div 6 list', event: 'Dianetics #46', stage: 'Attended', consent: 'Email only',
    fsm: '—', ruin: 'Not yet recorded', journey: 'Attended, no booking',
    history: [
      ['05 Aug', 'Imported — Spring open house list'],
      ['11 Aug', 'Lecture invitation opened'],
      ['14 Aug', 'Registered'],
      ['14 Aug', 'Attended — 55 of 55 minutes'],
      ['17 Aug', 'Nurture step 2 delivered']
    ]
  },
  {
    name: 'Priya Raman', email: 'priya.r@mail.com', phone: '+1 612 555 0107',
    source: 'Referral', event: 'Dianetics #47', stage: 'Completed', consent: 'Email, WhatsApp',
    fsm: 'S. Lindgren', ruin: 'Grief or loss', journey: 'Book buyer',
    history: [
      ['12 Aug', 'Referred by field member J. Okonjo'],
      ['21 Aug', 'Attended lecture'],
      ['24 Aug', 'Interview delivered — 46 minutes'],
      ['24 Aug', 'Book sold ($25) · pathway: Dianetics book'],
      ['25 Aug', 'Story signal flagged to success line']
    ]
  },
  {
    name: 'Tom Fitzgerald', email: 'tomf@mail.com', phone: '+1 763 555 0166',
    source: 'Meetup', event: 'Dianetics #47', stage: 'No-show', consent: 'Email, SMS',
    fsm: 'D. Whitfield', ruin: 'Work & livelihood', journey: 'No-show recovery',
    history: [
      ['21 Aug', 'Attended lecture'],
      ['22 Aug', 'Booked 25 Aug 12:00 PM CT'],
      ['25 Aug', 'No-show recorded by FSM'],
      ['25 Aug', 'Rescheduling path sent']
    ]
  },
  {
    name: 'Elena Duarte', email: 'e.duarte@mail.com', phone: '+1 612 555 0133',
    source: 'Social (SCN group)', event: 'Dianetics #46', stage: 'Interested', consent: 'Email only',
    fsm: '—', ruin: 'Relationships / family', journey: 'Interested, unbooked',
    history: [
      ['13 Aug', 'Clicked approved social post'],
      ['14 Aug', 'Registered and attended'],
      ['15 Aug', 'Requested consultation — link issued'],
      ['19 Aug', 'Reminder 2 sent']
    ]
  },
  {
    name: 'Robert Chen', email: 'rchen@mail.com', phone: '+1 651 555 0119',
    source: 'Div 6 list', event: 'Dianetics #45', stage: 'Completed', consent: 'Email, Signal',
    fsm: 'S. Lindgren', ruin: 'Purpose & direction', journey: 'DN Seminar buyer',
    history: [
      ['22 Jul', 'Imported — Winter list'],
      ['31 Jul', 'Attended lecture'],
      ['04 Aug', 'Interview delivered'],
      ['04 Aug', 'DN Seminar sold ($50)'],
      ['12 Aug', 'Seminar preparation sequence complete']
    ]
  },
  {
    name: 'Anita Sørensen', email: 'anita.s@mail.com', phone: '+1 612 555 0175',
    source: 'Meetup', event: 'Dianetics #47', stage: 'Registered', consent: 'Email only',
    fsm: '—', ruin: '—', journey: 'Pre-event reminders',
    history: [
      ['20 Aug', 'Registered from Meetup listing'],
      ['20 Aug', 'Confirmation sent'],
      ['24 Aug', 'Three-day reminder scheduled']
    ]
  },
  {
    name: 'Gerald Mwangi', email: 'g.mwangi@mail.com', phone: '+1 763 555 0188',
    source: 'Referral', event: 'Dianetics #46', stage: 'Not a fit', consent: 'Opted out',
    fsm: 'D. Whitfield', ruin: 'Study / learning', journey: 'Suppressed',
    history: [
      ['09 Aug', 'Registered via referral link'],
      ['14 Aug', 'Attended'],
      ['18 Aug', 'Interview delivered — not qualified'],
      ['19 Aug', 'Unsubscribed — global suppression applied']
    ]
  }
];

export const PATHWAYS = {
  'Relationships / family': [
    ['Dianetics book', 'chapter guide on affinity'],
    ['Dianetics Seminar', 'next: 6 Sep'],
    ['Second interview', 'with a senior FSM'],
    ['Introductory film screening', 'Sunday 2 PM']
  ],
  'Work & livelihood': [
    ['Dianetics book', 'self-study start'],
    ['Dianetics Seminar', 'next: 6 Sep'],
    ['Second interview', 'with a senior FSM'],
    ['Introductory film screening', 'Sunday 2 PM']
  ],
  'Health & well-being': [
    ['Dianetics book', 'self-study start'],
    ['Dianetics Seminar', 'next: 6 Sep'],
    ['Second interview', 'with a senior FSM'],
    ['Introductory film screening', 'Sunday 2 PM']
  ],
  'Grief or loss': [
    ['Dianetics book', 'self-study start'],
    ['Dianetics Seminar', 'next: 6 Sep'],
    ['Second interview', 'with a senior FSM'],
    ['Introductory film screening', 'Sunday 2 PM']
  ],
  'Stress & anxiety': [
    ['Dianetics book', 'self-study start'],
    ['Dianetics Seminar', 'next: 6 Sep — 2 seats'],
    ['Second interview', 'with a senior FSM'],
    ['Introductory film screening', 'Sunday 2 PM']
  ],
  'Study / learning': [
    ['Dianetics book', 'self-study start'],
    ['Dianetics Seminar', 'next: 6 Sep'],
    ['Second interview', 'with a senior FSM'],
    ['Introductory film screening', 'Sunday 2 PM']
  ],
  'Purpose & direction': [
    ['Dianetics book', 'self-study start'],
    ['Dianetics Seminar', 'next: 6 Sep'],
    ['Second interview', 'with a senior FSM'],
    ['Introductory film screening', 'Sunday 2 PM']
  ]
};

export const JOURNEYS = [
  {
    id: 'j1', name: 'Attended, did not schedule', entry: 'Attended · no appointment in 5 days',
    enrolled: '86 enrolled', objective: 'answer questions and invite a low-friction consultation',
    exit: 'books, opts out, becomes inactive, or reaches the terminal step',
    stats: [['Enrolled', '86'], ['Booked from journey', '19'], ['Opt-out rate', '1.2%']],
    steps: [
      ['Day 0 · 19:00', 'Thank you for attending', 'Recap, the one question most attendees ask, consultation offer', 'Email', '61% open'],
      ['Day 2 · 09:00', '“What a consultation actually is”', '90-second captioned video, no obligation language', 'Email', '44% open'],
      ['Day 4 · 17:00', 'Answer to the most common question', 'Retrieved from approved content library', 'Email', '38% open'],
      ['Day 7 · 10:00', 'Personal note from the host', 'Host-approved template, scheduling link', 'Email + SMS', '27% click'],
      ['Day 12 · 10:00', 'Respectful “not now”', 'Frequency drops to monthly; exit to dormant', 'Email', '—']
    ]
  },
  {
    id: 'j2', name: 'Booked but no-showed', entry: 'Appointment status → no-show',
    enrolled: '14 enrolled', objective: 'remove embarrassment and offer simple rescheduling',
    exit: 'rescheduled, completes, opts out, or expires',
    stats: [['Enrolled', '14'], ['Rescheduled', '6'], ['Median time to rebook', '3 d']],
    steps: [
      ['+2 hours', '“We missed you — no problem”', 'One-tap rescheduling link, no guilt language', 'Email + SMS', '72% open'],
      ['Day 1', 'FSM personal note', 'Sent from the assigned FSM, offers a different time band', 'Email', '55% open'],
      ['Day 4', 'Alternative format offered', 'Phone consultation or the next lecture instead', 'Email', '31% open'],
      ['Day 9', 'Close the loop', 'Exit to dormant attendee journey', 'Email', '—']
    ]
  },
  {
    id: 'j3', name: 'Interview completed, no book', entry: 'Outcome recorded · no product result',
    enrolled: '32 enrolled', objective: 'address the recorded objection and offer further education',
    exit: 'buys, declines, opts out, or expires',
    stats: [['Enrolled', '32'], ['Converted later', '7'], ['Objection: cost', '48%']],
    steps: [
      ['Day 1', 'Thank you and summary', 'Restates the Ruin in their own words; approved language only', 'Email', '68% open'],
      ['Day 3', 'Objection-matched content', 'Branch on the qual-handling objection category', 'Email', '41% open'],
      ['Day 8', 'Invitation to the film screening', 'Low-commitment next step', 'Email', '29% open'],
      ['Day 20', 'Second conversation offered', 'Only if FSM marked follow-up required', 'Email + phone task', '—']
    ]
  },
  {
    id: 'j4', name: 'Book buyer', entry: 'Product result includes a book',
    enrolled: '41 enrolled', objective: 'encourage use, gather feedback, introduce the seminar',
    exit: 'buys next product, refers, opts out, or expires',
    stats: [['Enrolled', '41'], ['Seminar uptake', '11'], ['Story leads', '5']],
    steps: [
      ['Day 2', '“How to get the most from it”', 'Reading guide, first-chapter prompt', 'Email', '74% open'],
      ['Day 7', 'Check-in and feedback', 'Two-question form, feeds story signals', 'Email', '52% open'],
      ['Day 14', 'Seminar invitation', 'Ties the book to the next step', 'Email', '39% open'],
      ['Day 30', 'Story request if flagged', 'Only with recorded testimonial consent', 'Email', '—']
    ]
  },
  {
    id: 'j5', name: 'DN Seminar buyer', entry: 'Product result includes a seminar',
    enrolled: '18 enrolled', objective: 'prepare for the seminar and lift attendance',
    exit: 'attends, advances, opts out, or expires',
    stats: [['Enrolled', '18'], ['Attendance rate', '83%'], ['Referrals', '4']],
    steps: [
      ['On sale', 'Confirmation and what to bring', 'Logistics plus expectation setting', 'Email', '88% open'],
      ['3 days before', 'Preparation note', 'Short video from the seminar supervisor', 'Email', '64% open'],
      ['1 day before', 'Reminder and directions', 'Time, place, parking, contact number', 'Email + SMS', '79% open'],
      ['+2 days', 'After the seminar', 'Referral ask and story intake link', 'Email', '46% open']
    ]
  },
  {
    id: 'j6', name: 'Interested but unqualified', entry: 'Interest recorded · FSM marked not a fit',
    enrolled: '23 enrolled', objective: 'provide general education and preserve goodwill',
    exit: 'requalifies, opts out, or expires',
    stats: [['Enrolled', '23'], ['Requalified', '3'], ['Frequency cap', 'monthly']],
    steps: [
      ['Day 3', 'General education piece', 'No product ask', 'Email', '43% open'],
      ['Day 30', 'Open invitation to a lecture', 'Public event listing only', 'Email', '25% open'],
      ['Day 90', 'Requalification check', 'Single question: has anything changed?', 'Email', '—']
    ]
  },
  {
    id: 'j7', name: 'Dormant attendee', entry: 'No engagement after all primary journeys',
    enrolled: '112 enrolled', objective: 'periodic reactivation with strict frequency limits',
    exit: 're-engages or becomes suppressed',
    stats: [['Enrolled', '112'], ['Reactivated', '9'], ['Suppressed', '31']],
    steps: [
      ['Quarter 1', 'New lecture series announcement', 'Value-first, one link', 'Email', '18% open'],
      ['Quarter 2', 'Success story (approved)', 'Consent-verified story only', 'Email', '14% open'],
      ['Quarter 3', 'Final check-in', 'Explicit “stay or go” choice; auto-suppress on silence', 'Email', '—']
    ]
  }
];

export const COURSES = {
  'FSM': [
    ['Calendar and availability setup', 'Connect a calendar, set buffers, publish the booking link', '100%', '4 videos · 18 min', 'Complete', 'ok'],
    ['Preparing for the interview', 'Reading the attendee record, preparation checklist', '100%', '3 videos · 12 min', 'Complete', 'ok'],
    ['Delivering the one-on-one', 'Establishing the Ruin in the person’s own words', '60%', '6 videos · 34 min', 'In progress', 'warn'],
    ['Recording the outcome', 'Every field, what counts as delivered, common errors', '0%', '2 videos · 9 min', 'Not started', 'bad'],
    ['Approved Dianetics pathways', 'What may and may not be offered; approved language', '0%', '5 videos · 22 min · assessment', 'Required', 'bad'],
    ['Follow-up and handover', 'Due dates, ownership, escalating to qual', '0%', '3 videos · 14 min', 'Not started', 'bad']
  ],
  'Host': [
    ['Opening the lecture', 'Room setup, first three minutes, tone', '100%', '3 videos · 11 min', 'Complete', 'ok'],
    ['Explaining the consultation', 'What to say so interest is genuine', '100%', '2 videos · 8 min', 'Complete', 'ok'],
    ['Handling questions live', 'Chat moderation and approved answers', '45%', '4 videos · 19 min', 'In progress', 'warn'],
    ['Issuing scheduling links', 'Who gets a link, when, and how it is tracked', '0%', '2 videos · 7 min', 'Not started', 'bad']
  ],
  'Qual handling': [
    ['Qualification standards', 'What qualified means here', '100%', '3 videos · 13 min', 'Complete', 'ok'],
    ['Common objections', 'Cost, time, scepticism, family agreement', '35%', '6 videos · 27 min', 'In progress', 'warn'],
    ['Escalation paths', 'When to bring in a supervisor', '0%', '2 videos · 9 min', 'Required', 'bad']
  ],
  'Campaign manager': [
    ['List uploads and lawful basis', 'Mapping, validation, source labels', '100%', '4 videos · 16 min', 'Complete', 'ok'],
    ['Campaign setup and attribution', 'Codes, UTM parameters, source reporting', '70%', '3 videos · 15 min', 'In progress', 'warn'],
    ['Consent and suppression', 'Opt-out handling, quiet hours, CAN-SPAM', '0%', '3 videos · 14 min · assessment', 'Required', 'bad']
  ],
  'Disseminator': [
    ['Invitation language', 'Approved wording for personal invitations', '20%', '3 videos · 10 min', 'In progress', 'warn'],
    ['Referral links', 'How attribution reaches your record', '0%', '1 video · 4 min', 'Not started', 'bad']
  ],
  'Recruiter': [
    ['Recruitment conversations', 'Opening, listening, honest expectations', '0%', '5 videos · 24 min', 'Not started', 'bad'],
    ['Orientation webinar delivery', 'Running the session and the follow-up', '0%', '3 videos · 17 min', 'Not started', 'bad']
  ],
  'Success line': [
    ['Story intake', 'The form, the questions, what not to ask', '55%', '3 videos · 12 min', 'In progress', 'warn'],
    ['Release and consent process', 'Channels, expiry, withdrawal', '0%', '2 videos · 11 min · assessment', 'Required', 'bad']
  ]
};

export const STAGE_ORDER = ['Submitted', 'Screened', 'Interview requested', 'Recorded', 'Drafted', 'Consent pending', 'Approved', 'Published'];

export const STORY_BASE = [
  ['Priya Raman', 'Dianetics #47 · FSM S. Lindgren', 'Handled grief after her father died; finished the book in a week', 'Submitted', 'Not requested'],
  ['Robert Chen', 'Dianetics #45 · FSM S. Lindgren', 'Changed career direction after the seminar', 'Screened', 'Requested'],
  ['Marta Olsen', 'Dianetics #44 · FSM D. Whitfield', 'Sleeping through the night for the first time in years', 'Recorded', 'Signed'],
  ['J. Okonjo (field)', 'Recruitment referral', 'Why he brings friends to the lecture', 'Drafted', 'Signed'],
  ['Elena Duarte', 'Dianetics #46 · host A. Reyes', 'Reconciled with her sister after the interview', 'Approved', 'Signed — social + newsletter']
];

export const APPTS = [
  ['Today 6:30 PM', 'CT', 'Karen Iversen', 'Dianetics #47', 'D. Whitfield', 'Confirmed', 'ok', '—'],
  ['Today 8:00 PM', 'CT', 'Anita Sørensen', 'Dianetics #47', 'D. Whitfield', 'Booked', 'warn', 'Confirm by 4 PM'],
  ['Tomorrow 12:00 PM', 'CT', 'Elena Duarte', 'Dianetics #46', 'S. Lindgren', 'Reminder due', 'warn', 'Send 24 h reminder'],
  ['Tomorrow 5:15 PM', 'ET', 'Marcus Bell', 'Dianetics #46', 'J. Okonjo', 'Offered', 'accent', 'Link expires in 2 d'],
  ['25 Aug 12:00 PM', 'CT', 'Tom Fitzgerald', 'Dianetics #47', 'D. Whitfield', 'No-show', 'bad', 'Rescheduling path sent'],
  ['24 Aug 3:00 PM', 'CT', 'Priya Raman', 'Dianetics #47', 'S. Lindgren', 'Completed', 'ok', 'Outcome recorded'],
  ['23 Aug 11:00 AM', 'CT', 'Robert Chen', 'Dianetics #45', 'S. Lindgren', 'Completed', 'ok', 'Follow-up due 27 Aug']
];

export const MAPPING = [
  ['first_name', 'Karen', 'Contact · first name', 'Mapped', 'ok'],
  ['last_name', 'Iversen', 'Contact · last name', 'Mapped', 'ok'],
  ['e-mail', 'k.iversen@mail.com', 'Contact · email (match key)', 'Mapped', 'ok'],
  ['mobile', '612-555-0148', 'Contact · phone', 'Mapped', 'ok'],
  ['zip', '55403', 'Contact · postal code', 'Mapped', 'ok'],
  ['notes', 'Met at open house', 'Contact · source notes', 'Mapped', 'ok'],
  ['interest', 'DN book', 'Unmapped — ignore or create tag', 'Needs decision', 'warn']
];

export const IMPORTS = [
  ['spring-open-house-2026.csv', '16 Aug 2026', '1,284', '1,197', '19', 'Pending activation'],
  ['winter-list-2026.xlsx', '04 Feb 2026', '862', '791', '34', 'Active'],
  ['book-fair-signups.csv', '11 Nov 2025', '318', '288', '12', 'Active'],
  ['legacy-cards-2019.csv', '02 Sep 2025', '2,410', '0', '2,410', 'Rejected — no lawful basis']
];

export const ORGS = [
  ['Church of Scientology of Twin Cities', 'Pilot', '12', '1,840', 'Mapped', 'Live'],
  ['Church of Scientology of Boston', 'Wave 2', '4', '0', 'Pending', 'Onboarding'],
  ['Church of Scientology of Seattle', 'Wave 2', '3', '0', 'Pending', 'Onboarding'],
  ['Church of Scientology of Chicago', 'Wave 3', '0', '0', '—', 'Queued'],
  ['Church of Scientology of Los Angeles', 'Wave 3', '0', '0', '—', 'Queued']
];

export const ROLES_TABLE = [
  ['Platform administrator', 'All organizations', 'Full system access; audited'],
  ['Church administrator', 'Own Church', 'Lists, campaigns, users, reports'],
  ['Campaign manager / host', 'Own Church', 'Events, attendees, nurture, scheduling'],
  ['Field Staff Member', 'Assigned contacts', 'Availability, outcome forms, training'],
  ['Field disseminator', 'Limited', 'Orientation & referral materials only'],
  ['Trainer / qual supervisor', 'Training domain', 'Content, assessments, sign-off'],
  ['Success-line staff', 'Stories', 'Intake, consent, editorial pipeline'],
  ['Read-only executive', 'Authorized orgs', 'Dashboards only; no edits']
];
