// Limits: every cap in the game's rules, in one place. Each has a default, and Parliament can change it with a
// 'set' clause in a bill (or a decree). The current value lives in w.config.limits[key]; lim() falls back to the default.
// The min/max here bound what a law may set, so nothing can be pushed past what the free-tier server can carry.
// Not here: input-safety bounds (text lengths, nesting, sane amounts) and the Convention's own caps (it sits before any Parliament).
export type Limit = { label: string; unit: string; def: number; min: number; max: number; area: string };

const L = (area: string, label: string, def: number, min: number, max: number, unit = ''): Limit => ({ area, label, def, min, max, unit });
const CR = ' crowns';

export const LIMITS: Record<string, Limit> = {
  // Parliament
  billClauses: L('Parliament', 'Clauses in one bill', 20, 5, 50),
  billSpeeches: L('Parliament', 'Speeches each MP may make on a bill', 5, 1, 20),
  amendmentsEach: L('Parliament', 'Amendments each MP may have waiting on a bill', 3, 1, 10),
  hostileBackers: L('Parliament', 'MPs backing an amendment to force a House vote', 3, 1, 9),
  lobbyMax: L('Parliament', 'Most one lobbying payment may be', 100, 10, 1000, CR),
  blocksPerTerm: L('Parliament', 'Times an office may send a bill back each term', 1, 0, 5),
  formDays: L('Parliament', 'Days a hung parliament has to form a government', 5, 2, 14, ' days'),
  draftsEach: L('Parliament', 'Drafts each citizen may keep', 20, 5, 50),
  draftSponsors: L('Parliament', 'Co-sponsors on one draft', 6, 1, 15),
  officeBudgetMax: L('Parliament', 'Highest weekly budget a law may give an office', 200, 50, 1000, CR),
  jobPayMax: L('Parliament', 'Highest pay for a civic job', 30, 5, 100, CR),
  pensionMax: L('Parliament', 'Highest veterans’ pension', 10, 1, 50, CR),
  fundMax: L('Parliament', 'Most the wealth fund may trade in one law', 500, 50, 5000, CR),
  peaceCrownsMax: L('Parliament', 'Most a peace may pay either way', 200, 50, 2000, CR),
  // Parties
  partyMotions: L('Parties', 'Party motions each member may have open', 3, 1, 10),
  breakawayMPs: L('Parties', 'MPs a breakaway needs before it can launch', 2, 1, 9),
  breakawayInvite: L('Parties', 'Members one breakaway may invite', 15, 3, 40),
  // Money
  reserveRateMax: L('Money', 'Highest Reserve interest rate', 15, 5, 50, '%'),
  bankSaveMax: L('Money', 'Highest savings rate a bank may offer', 10, 1, 50, '%'),
  bankLoanMax: L('Money', 'Highest loan rate a bank may charge', 20, 1, 100, '%'),
  loanMax: L('Money', 'Largest bank loan', 100, 10, 2000, CR),
  loanWeeks: L('Money', 'Longest bank loan', 10, 1, 52, ' weeks'),
  ventureMax: L('Money', 'Largest trade venture', 100, 10, 1000, CR),
  mintMax: L('Money', 'Most the Reserve may print at once', 200, 10, 2000, CR),
  mintWeek: L('Money', 'Most the Reserve may print in a week', 400, 10, 5000, CR),
  bondRateMax: L('Money', 'Highest interest on a bond issue', 10, 1, 50, '% a week'),
  bondWeeksMax: L('Money', 'Longest bond term', 8, 1, 52, ' weeks'),
  bondIssueMax: L('Money', 'Largest bond issue', 1000, 50, 10000, CR),
  goldMax: L('Money', 'Most gold the Reserve may buy at once', 200, 10, 2000, CR),
  // The Exchange
  holdMax: L('Exchange', 'Shares one holder may own of a company', 1000, 100, 10000),
  stampDutyMax: L('Exchange', 'Highest stamp duty on shares', 5, 0, 25, '%'),
  companiesEach: L('Exchange', 'Listed companies each citizen may run', 2, 1, 10),
  ipoMax: L('Exchange', 'Highest opening price on a listing', 50, 5, 500, CR),
  listSharesMax: L('Exchange', 'Most shares a new listing may issue', 1000, 100, 10000),
  capitalMax: L('Exchange', 'Most starting capital for a new company', 500, 50, 5000, CR),
  // Offices
  grantMax: L('Offices', 'Largest single grant from an office', 100, 10, 1000, CR),
  fineMax: L('Offices', 'Largest fine', 10, 1, 100, CR),
  // Society
  storiesPerDay: L('Society', 'Stories each journalist may file a day', 5, 1, 20),
  pollPanel: L('Society', 'Newsnight comments on one exit poll', 5, 1, 20),
  crisisSpeeches: L('Society', 'Speeches each citizen may make on a crisis', 2, 1, 10),
  crisisGift: L('Society', 'Most each citizen may give to one crisis', 25, 5, 500, CR),
  crisisBribeMax: L('Society', 'Largest offer to sway a crisis', 50, 5, 500, CR),
  betMax: L('Society', 'Most each citizen may stake on one market', 100, 10, 1000, CR),
  streakFreezes: L('Society', 'Streak freezes one citizen may hold', 2, 0, 10),
  // The Streets
  contractStakeMax: L('Streets', 'Largest stake on a contract', 100, 10, 1000, CR),
  bountiesEach: L('Streets', 'Bounties each citizen may have going', 3, 1, 10),
  bountyMax: L('Streets', 'Largest bounty reward', 200, 10, 2000, CR),
  stallsEach: L('Streets', 'Stalls each citizen may have open', 3, 1, 10),
  stallPriceMax: L('Streets', 'Highest price on a stall', 200, 10, 2000, CR),
  // The Army and the Empire
  regiments: L('Army', 'Regiments the realm may field', 20, 6, 60),
  volunteers: L('Army', 'Volunteers in one war', 12, 1, 50),
  warBondsEach: L('Army', 'War bonds each citizen may hold', 100, 10, 1000, CR),
  requisitionWeek: L('Army', 'Most the war chest may draw from the Treasury a week', 100, 0, 2000, CR),
  campaignMax: L('Army', 'Most one may spend campaigning for a foreign throne', 100, 10, 1000, CR),
  purseMax: L('Army', 'Largest purse a monarch may offer a pretender', 100, 10, 1000, CR),
  // The backroom
  dealsOpen: L('Backroom', 'Deals each citizen may have waiting for an answer', 5, 1, 20),
  probesPerDay: L('Backroom', 'Investigations the Security Service may make a day', 1, 1, 5),
  warChestFull: L('Backroom', 'A plot’s war chest is full at', 150, 50, 1000, CR),
  // Regimes
  cells: L('Regimes', 'Citizens a regime may hold at once', 3, 1, 10),
  pamphletsPerDay: L('Regimes', 'Underground pamphlets each citizen may print a day', 2, 1, 10)
};

// the current value of a limit: what the law says, else the default
export function lim(w: any, key: string): number {
  const d = LIMITS[key];
  if (!d) throw new Error('Unknown limit ' + key);
  const v = w?.config?.limits?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : d.def;
}
export const isLimit = (key: unknown): key is string => typeof key === 'string' && Object.prototype.hasOwnProperty.call(LIMITS, key);
