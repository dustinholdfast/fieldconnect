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
  o: {
    delivered: 'yes', duration: '46', result: 'Qualified', channel: 'Email',
    ruinCat: '', desired: '', ruinNotes: '', pathway: '',
    books: '1', bookValue: '25', seminars: '0', semValue: '50',
    next: '', due: '', objection: '', storySignal: 'No',
    consent0: true, consent1: false, consent2: false
  }
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
    delivered: 'yes', duration: '', result: '', channel: 'Email',
    ruinCat: '', desired: '', ruinNotes: '', pathway: '',
    books: '0', bookValue: '0', seminars: '0', semValue: '0',
    next: '', due: '', objection: '', storySignal: 'No',
    consent0: false, consent1: false, consent2: false
  };
}
