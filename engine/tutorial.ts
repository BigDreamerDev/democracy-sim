// Induction missions: a short checklist that walks a new player through every system by doing it once.
// A mission is ticked when the player runs one of its commands (see run() in index.ts), or, for reading
// missions, when they open the page (the 'tutorial.visit' command). Progress is kept on the citizen as
// c.tutorial = { [missionId]: time } and survives the end of induction week, when each mission is worth
// 1 real Influence and finishing them all earns the "Inducted" stamp.
import { W, Id, fail, earn, stamp } from './core';

export type Mission = { id: string; title: string; text: string; href: string; cmds?: string[]; visit?: boolean; system: string };

export const TUTORIAL: Mission[] = [
  { id: 'welcome', system: 'Basics', title: 'Read how the realm works', text: 'Two minutes on what you can do and how you win.', href: '#/learn', visit: true },
  { id: 'convention', system: 'Basics', title: 'Shape the constitution', text: 'Vote on a Convention clause, add an option or table a clause of your own.', href: '#/convention', cmds: ['convention.vote', 'convention.suggest', 'convention.propose'] },
  { id: 'law', system: 'Basics', title: 'Read the Founding Act', text: 'The rules everyone agreed. Every later law sits on top of it.', href: '#/law/L001', visit: true },
  { id: 'stand', system: 'Elections', title: 'Stand for election', text: 'Put your name on a ballot. Anyone can.', href: '#/elections', cmds: ['election.stand'] },
  { id: 'ballot', system: 'Elections', title: 'Cast a ballot', text: 'Secret and final. The top candidates nationwide take the seats.', href: '#/elections', cmds: ['election.vote'] },
  { id: 'party', system: 'Parties', title: 'Join or found a party', text: 'Parties win seats together. Founding one takes two co-founders.', href: '#/parties', cmds: ['party.found', 'party.cosign', 'party.join'] },
  { id: 'debate', system: 'Parliament', title: 'Speak in a debate', text: 'On a bill or a crisis. Anyone can speak; only MPs vote on most things.', href: '#/proposals', cmds: ['prop.speak', 'crisis.speak'] },
  { id: 'vote', system: 'Parliament', title: 'Vote in the House', text: 'On a proposal, a referendum or a crisis.', href: '#/proposals', cmds: ['prop.vote', 'crisis.vote', 'crisis.decide'] },
  { id: 'question', system: 'Parliament', title: 'Hold the government to account', text: "Ask or back a question for PM's Questions.", href: '#/questions', cmds: ['q.ask', 'q.back'] },
  { id: 'money', system: 'Money', title: 'Move some money', text: 'Send crowns, put them in a bank, or invest abroad.', href: '#/wallet', cmds: ['money.send', 'bank.deposit', 'venture.start'] },
  { id: 'press', system: 'Press', title: 'Make the news', text: 'Start a paper, file a story or cheer one.', href: '#/press', cmds: ['press.found', 'press.submit', 'press.cheer', 'press.follow'] },
  { id: 'backroom', system: 'Backroom', title: 'Make a private deal', text: 'Nobody else sees it, unless one of you exposes it.', href: '#/backroom', cmds: ['deal.offer', 'deal.answer'] }
];
const BY_CMD: Record<string, string[]> = {};
TUTORIAL.forEach((m) => (m.cmds || []).forEach((c) => (BY_CMD[c] = [...(BY_CMD[c] || []), m.id])));

function tickMission(w: W, id: Id, mission: string) {
  const c = w.citizens[id];
  if (!c) return;
  c.tutorial = c.tutorial || {};
  if (c.tutorial[mission]) return;
  c.tutorial[mission] = w.now;
  // during induction this Influence is practice; the real reward comes when induction ends
  earn(w, id, 1, 'Induction mission: ' + TUTORIAL.find((m) => m.id === mission)!.title);
  if (Object.keys(c.tutorial).length === TUTORIAL.length && !(w.induction && !w.induction.done)) stamp(w, id, 'Inducted', 'All missions', 'ink');
}
// called by run() after every successful command
export function afterCommand(w: W, actor: Id, cmd: string) {
  (BY_CMD[cmd] || []).forEach((m) => tickMission(w, actor, m));
}
export function visitMission(w: W, actor: Id, mission: string) {
  const m = TUTORIAL.find((x) => x.id === mission);
  if (!m || !m.visit) fail('That mission is done by doing, not reading.');
  tickMission(w, actor, mission);
}
