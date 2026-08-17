let onRoute = null;

export const state = {
  role: 'manager',
  user: null,
  org: null,
  route: { screen: 'dashboard', params: {}, query: {}, path: '/dashboard', known: true },
  screen: 'dashboard',
  contactIdx: 0,
  stageFilter: 'All',
  crmQuery: '',
  crmPeople: [],
  crmTotal: 0,
  crmSelected: undefined,
  crmFsms: [],
  crmNote: null,
  journeyId: 'j1',
  uploadStep: 1,
  importHistory: [],
  importCurrent: null,
  importMissing: false,
  importMessage: null,
  importBusy: false,
  sourceLabel: '',
  lawfulBasis: 'legitimate_interest_event',
  track: 'FSM',
  adapterOn: false,
  submitted: false,
  error: null,
  storyStages: {},
  outcomeAppointment: null,
  outcomeCatalog: null,
  outcomePathways: null,
  outcomePicker: null,
  o: {
    appointmentId: null,
    clientId: null,
    delivered: 'yes',
    duration: '46',
    partialReason: '',
    result: 'Qualified',
    channel: 'Email',
    ruinCat: '',
    desired: '',
    ruinNotes: '',
    pathway: '',
    lineItems: [],
    next: '',
    due: '',
    objection: '',
    storySignal: 'No',
    consents: { followup: true, testimonial: false, publicStory: false },
  },
};

export function setRouteHandler(fn) {
  onRoute = fn;
}

export function setState(partial, flags = {}) {
  Object.assign(state, partial);
  if (partial.route?.screen) state.screen = partial.route.screen;
  if (flags.shell || flags.content) onRoute?.(state.route, flags);
}

export function defaultOutcome() {
  return {
    appointmentId: null,
    clientId: null,
    delivered: 'yes',
    duration: '',
    partialReason: '',
    result: '',
    channel: 'Email',
    ruinCat: '',
    desired: '',
    ruinNotes: '',
    pathway: '',
    lineItems: [],
    next: '',
    due: '',
    objection: '',
    storySignal: 'No',
    consents: { followup: false, testimonial: false, publicStory: false },
  };
}
