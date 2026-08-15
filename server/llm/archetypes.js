'use strict';

/*
 * Pre-written foreign governments.
 *
 * The reason this file exists: configuring a foreign power used to mean knowing
 * a provider, a model ID that passes the free-tier allowlist, and writing a
 * system prompt per minister. That cost is paid before any fun is had, so
 * nobody paid it and the feature went unused.
 *
 * An archetype is a whole government: who decides, who sits in the cabinet,
 * how fast it may act, what it will never do, and how it answers pressure. It
 * is deliberately NOT just a prompt. A costume changes nothing a player can
 * feel; a decision method, an action budget and a hard refusal all do.
 *
 * Everything here is data. Nothing in this file executes anything, decides
 * anything or touches the database — diplomacy.js reads it, and every action
 * kind still goes through that module's ACTIONS allowlist before a row is
 * written. An archetype can only ever narrow what a government may do.
 */

/* The action kinds diplomacy.js will execute. Duplicated here so a refusal can
   be written against a name that exists; diplomacy.js remains the authority and
   checks its own set before anything is stored. */
const KINDS = ['nothing', 'dispatch', 'treaty', 'ratify', 'denounce', 'offer', 'buy', 'declare'];

/* ------------------------------------------------------------ small helpers */

const lower = v => String(v == null ? '' : v).toLowerCase();

/* Everything a refusal or a script is allowed to read out of a payload, as one
   flat lowercase string. Payload prose is player-adjacent and untrusted, so it
   is only ever pattern-matched, never interpreted. */
function payloadText(p) {
  if (!p || typeof p !== 'object') return '';
  return lower(
    [p.subject, p.body, p.title, p.articles, p.grievance, p.demands, p.description]
      .filter(Boolean)
      .join(' \n ')
  );
}

const HOLY = /\b(holy|sacred|shrine|temple|relic|pilgrim|consecrat|sanctuar)/;

/* A deterministic 32-bit hash. The mock provider needs to vary between
   ministers and between cycles without ever rolling a die — war.js refuses
   randomness on principle and a foreign government that behaves differently on
   a replayed turn would be unarguable in exactly the same way. */
function hash(...parts) {
  let h = 2166136261;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

/* ------------------------------------------------------------- the catalogue

   Field meanings, once:

     decision_method   one of diplomacy.js's DECISIONS
     decision_threshold  only consulted by `consensus`
     max_rounds        deliberation rounds before the decision rule applies
     actions_per_cycle official actions this power may take in a cycle. Capped
                       by the Republic's own foreign_actions_per_cycle — an
                       archetype may be slower than the Republic allows, never
                       faster.
     posture           how the government answers conflict pressure, applied as
                       a deterministic bias on proposal priority
     refusals          things this government will not do, whatever a model
                       returns. Checked after the action-kind allowlist.
     cabinet           ministers, created for you. `temperament` drives the
                       mock provider; `prompt` drives a real one. */

const ARCHETYPES = {
  military_junta: {
    id: 'military_junta',
    label: 'Military junta',
    blurb: 'Officers who took the palace and kept it. Fast, blunt, and it escalates.',
    decision_method: 'weighted',
    decision_threshold: 0.5,
    max_rounds: 1,
    actions_per_cycle: 3,
    posture: 'escalate',
    refusals: [
      {
        kinds: ['treaty', 'ratify'],
        why: 'The junta will not sign away the army’s freedom of action.',
        test: ({ terms }) => terms?.non_aggression === true
      },
      {
        kinds: ['nothing'],
        why: 'The junta does not sit still while a grievance is open.',
        test: (_p, ctx) => ctx.conflict_open === true
      }
    ],
    cabinet: [
      {
        role: 'chairman_of_the_council',
        display_name: 'The Chairman',
        vote_weight: 2,
        temperament: 'hawk',
        prompt:
          'You chair the Revolutionary Military Council and you hold power because the army obeys you. Prestige and deterrence come before commerce. You prefer a demand made early to a concession made late, but you do not spend the army on nothing.'
      },
      {
        role: 'chief_of_staff',
        display_name: 'The Chief of Staff',
        vote_weight: 1.5,
        temperament: 'hawk',
        prompt:
          'You command the armed forces. You judge every proposal by whether it improves or worsens your position if fighting starts next cycle. You warn plainly when the army is not ready.'
      },
      {
        role: 'foreign_secretary',
        display_name: 'The Foreign Secretary',
        vote_weight: 1,
        temperament: 'diplomat',
        prompt:
          'You are the one civilian in the room. Your job is to keep the junta from being isolated. You argue for correspondence before coercion and you are usually overruled.'
      }
    ]
  },

  merchant_republic: {
    id: 'merchant_republic',
    label: 'Merchant republic',
    blurb: 'Governed by its trading houses. It will sell to anyone and fights only when trade is already lost.',
    decision_method: 'cabinet',
    decision_threshold: 0.5,
    max_rounds: 2,
    actions_per_cycle: 3,
    posture: 'trade',
    refusals: [
      {
        kinds: ['declare'],
        why: 'The houses do not vote for a war that closes their own markets.',
        test: p => lower(p?.kind) === 'war'
      },
      {
        kinds: ['denounce'],
        why: 'A merchant republic does not tear up an open trade agreement.',
        test: (p, ctx) => ctx.treaty_by_id?.[String(p?.treaty_id)]?.trade_open === true
      }
    ],
    cabinet: [
      {
        role: 'first_consul',
        display_name: 'The First Consul',
        vote_weight: 1,
        temperament: 'trader',
        prompt:
          'You are elected by the trading houses and serve at their pleasure. Your test for any proposal is whether it opens a market or closes one. You are patient with insults and impatient with tariffs.'
      },
      {
        role: 'master_of_the_exchange',
        display_name: 'The Master of the Exchange',
        vote_weight: 1,
        temperament: 'trader',
        prompt:
          'You keep the ledgers of the republic. You argue in prices and volumes, not in principles, and you will support any arrangement that is profitable and any peace that is cheaper than a war.'
      },
      {
        role: 'envoy_of_the_houses',
        display_name: 'The Envoy of the Houses',
        vote_weight: 1,
        temperament: 'diplomat',
        prompt:
          'You negotiate on behalf of the trading houses. You are courteous to the point of insincerity, and you never let a dispute close a port if a letter would settle it.'
      },
      {
        role: 'captain_of_the_convoys',
        display_name: 'The Captain of the Convoys',
        vote_weight: 1,
        temperament: 'hawk',
        prompt:
          'You protect the shipping. You are the only voice for force in this cabinet, and you make it about the safety of cargo rather than about honour.'
      }
    ]
  },

  absolute_monarchy: {
    id: 'absolute_monarchy',
    label: 'Absolute monarchy',
    blurb: 'One crown decides, with no council that can lawfully say no. Its word does not get taken back, and it pays tribute to nobody. The throne outlives whoever sits on it.',
    decision_method: 'executive',
    decision_threshold: 0.5,
    max_rounds: 1,
    actions_per_cycle: 2,
    posture: 'legitimacy',
    /* No `council` field, deliberately — that absence IS the archetype. A
       constitutional monarchy has a body that can refuse to carry the crown's
       choice; an absolute one does not, and that is the entire distinction
       between the two decision methods being both nominally "one leader
       decides". */
    succession: {
      crown_role: 'sovereign',
      reign_cycles: 12,
      regency_cycles: 0, // the heir rules in full from the first day; there is no council to hold the regency for
      line: [
        {
          display_name: 'The Widowed Regent',
          temperament: 'treasurer',
          prompt:
            'You rule in the name of an heir not yet of age, and you intend to leave the treasury in better order than you found the throne — that is the legacy that will actually be judged, whatever the histories say about the reign itself.'
        },
        {
          display_name: 'The New Crown',
          temperament: 'sovereign',
          prompt:
            'You are sovereign in your own right now, and every court on this continent is watching to see whether the succession weakened you. You intend it to have done the opposite.'
        },
        {
          display_name: 'The War-Made Crown',
          temperament: 'hawk',
          prompt:
            "You came to the throne through your father's wars, not around them, and you do not intend to be remembered as the one who let go of what he won."
        }
      ]
    },
    refusals: [
      {
        kinds: ['treaty', 'ratify'],
        why: 'The Crown does not pay tribute.',
        test: ({ terms }) => Number(terms?.tribute_per_cycle) > 0
      },
      {
        kinds: ['denounce'],
        why: 'A sovereign does not withdraw a word already given.',
        test: (p, ctx) => ctx.treaty_by_id?.[String(p?.treaty_id)]?.ratified === true
      }
    ],
    cabinet: [
      {
        role: 'sovereign',
        display_name: 'The Crown',
        vote_weight: 3,
        temperament: 'sovereign',
        prompt:
          'You are the sovereign and the decision is yours alone. You listen to your ministers and you are not bound by them. You take slights to your dignity seriously and you regard a promise you have made as settled.'
      },
      {
        role: 'lord_chancellor',
        display_name: 'The Lord Chancellor',
        vote_weight: 1,
        temperament: 'diplomat',
        prompt:
          'You manage the Crown’s correspondence and its dignity. You advise what a monarch may accept without looking weak, which is a narrower thing than what is wise.'
      },
      {
        role: 'lord_treasurer',
        display_name: 'The Lord Treasurer',
        vote_weight: 1,
        temperament: 'treasurer',
        prompt:
          'You find the money. You are the only person permitted to tell the Crown that something is unaffordable, and you do it carefully.'
      }
    ]
  },

  constitutional_monarchy: {
    id: 'constitutional_monarchy',
    label: 'Constitutional monarchy',
    blurb: 'A crown that reigns inside a parliament that rules. The crown proposes; the ministry can leave it unbacked.',
    /* Weighted, not executive — the whole point is that the crown's vote is
       heavy but not decisive on its own. A ministry that unites against it
       can outvote it on paper, and even where the raw vote goes the crown's
       way, `council` below still has the last word for the acts that matter:
       the crown can choose, and the choice still needs the ministry behind
       it to bind the realm. */
    decision_method: 'weighted',
    decision_threshold: 0.5,
    max_rounds: 2,
    actions_per_cycle: 2,
    posture: 'legitimacy',
    council: {
      roles: ['first_minister', 'lord_chancellor', 'speaker_of_the_estates'],
      kinds: ['declare', 'treaty', 'ratify'],
      min_share: 0.5,
      why: 'The Crown-in-Parliament will not bind the realm to an act the ministry did not carry.'
    },
    succession: {
      crown_role: 'sovereign',
      reign_cycles: 10,
      regency_cycles: 1,
      line: [
        {
          display_name: 'The Regent-Heir',
          temperament: 'blocker',
          prompt:
            'You reign as regent for an heir not yet of age, and you know it. You avoid binding the crown to anything the ministry has not already agreed, because you cannot yet answer for it personally.'
        },
        {
          display_name: 'The Young Sovereign',
          temperament: 'diplomat',
          prompt:
            'You have come into your majority and you mean to be seen deciding — within what the constitution actually allows a monarch who reigns but does not rule.'
        },
        {
          display_name: 'The Reforming Crown',
          temperament: 'trader',
          prompt:
            'You believe the monarchy survives by being useful. You favour arrangements that make the crown look modern and the treasury look healthy, and you leave the ministry to do the actual ruling.'
        }
      ]
    },
    refusals: [
      {
        kinds: ['declare'],
        why: 'The Crown does not declare war on its own authority; a war needs the ministry to have already answered for it.',
        test: (p, ctx) => lower(p?.kind) === 'war' && !ctx.at_blockade
      },
      {
        kinds: ['nothing'],
        why: 'A constitutional crown that signs nothing invites the question of what the civil list is paying for.',
        test: (_p, ctx) => ctx.conflict_open === true && ctx.pressure >= 55
      }
    ],
    cabinet: [
      {
        role: 'sovereign',
        display_name: 'The Crown',
        vote_weight: 2,
        temperament: 'sovereign',
        prompt:
          'You reign, and you are careful about the difference between that and ruling. You say what you would prefer. You do not pretend the ministry is bound to agree, because it is not.'
      },
      {
        role: 'first_minister',
        display_name: 'The First Minister',
        vote_weight: 2,
        temperament: 'diplomat',
        prompt:
          'You lead His Majesty’s government and you answer to the assembly, not to the palace. You are courteous to the Crown and you do not confuse that courtesy with obedience.'
      },
      {
        role: 'lord_chancellor',
        display_name: 'The Lord Chancellor',
        vote_weight: 1,
        temperament: 'treasurer',
        prompt:
          'You keep the accounts of the realm, civil list included. You say plainly when a royal enthusiasm is a ministry expense, and you are usually the reason it does not happen.'
      },
      {
        role: 'speaker_of_the_estates',
        display_name: 'The Speaker of the Estates',
        vote_weight: 1,
        temperament: 'blocker',
        prompt:
          'You represent an assembly that does not trust the palace and does not entirely trust itself either. Your habitual answer is that a matter needs a vote it has not yet had.'
      }
    ]
  },

  theocratic_monarchy: {
    id: 'theocratic_monarchy',
    label: 'Theocratic monarchy',
    blurb: 'A crown that rules by divine sanction, and a clergy that can withhold it. Doctrine binds the throne as much as any law does.',
    decision_method: 'consensus',
    decision_threshold: 0.55,
    max_rounds: 2,
    actions_per_cycle: 2,
    posture: 'legitimacy',
    succession: {
      crown_role: 'anointed_sovereign',
      reign_cycles: 9,
      regency_cycles: 1, // the interregnum before the clergy has confirmed the new reign
      line: [
        {
          display_name: 'The Unconsecrated Heir',
          temperament: 'blocker',
          prompt:
            'You hold the throne, but the clergy has not yet anointed you. You avoid any act that would look like you ruled without their blessing, because for now you are ruling without it.'
        },
        {
          display_name: 'The Anointed Crown',
          temperament: 'sovereign',
          prompt:
            'The clergy has confirmed you, and your word now carries their weight as well as your own. You act accordingly, and you do not waste what the confirmation cost them to give.'
        },
        {
          display_name: 'The Pious Successor',
          temperament: 'zealot',
          prompt:
            'You came to the throne already devout, and you see little difference between the crown’s business and the temple’s. Some of your ministers find this a comfort and some find it a problem.'
        }
      ]
    },
    refusals: [
      {
        kinds: ['offer', 'buy', 'treaty', 'ratify'],
        why: 'Crown and clergy agree on this much: the holy sites are not the throne’s to sell.',
        test: p => HOLY.test(payloadText(p))
      },
      {
        kinds: ['declare'],
        why: 'The clergy will not bless a war it was not consulted on.',
        test: (p, ctx) => lower(p?.kind) === 'war' && ctx.pressure < 55
      }
    ],
    cabinet: [
      {
        role: 'anointed_sovereign',
        display_name: 'The Anointed Crown',
        vote_weight: 2,
        temperament: 'sovereign',
        prompt:
          'You hold the throne by right of blood and the altar’s confirmation both, and you treat the two as one legitimacy rather than two. You listen to the High Hierarch more than to anyone else in this room.'
      },
      {
        role: 'high_hierarch',
        display_name: 'The High Hierarch',
        vote_weight: 2,
        temperament: 'zealot',
        prompt:
          'You confirmed this reign and you can, in doctrine if not in practice, withdraw that confirmation. You measure the Crown’s proposals against the faith first and the treasury a distant second.'
      },
      {
        role: 'court_chamberlain',
        display_name: 'The Court Chamberlain',
        vote_weight: 1,
        temperament: 'diplomat',
        prompt:
          'You manage the throne’s correspondence and the delicate business of keeping the palace and the temple from openly disagreeing in front of foreign envoys.'
      },
      {
        role: 'lord_treasurer',
        display_name: 'The Lord Treasurer',
        vote_weight: 1,
        temperament: 'treasurer',
        prompt:
          'You find the money for a crown and a clergy that both spend it. You are the one voice in this room that speaks in numbers rather than in doctrine or dignity.'
      }
    ]
  },

  one_party_state: {
    id: 'one_party_state',
    label: 'One-party state',
    blurb: 'The Party is the state. Nothing goes unanswered, and war waits for the Party line.',
    decision_method: 'executive',
    decision_threshold: 0.5,
    max_rounds: 2,
    actions_per_cycle: 2,
    posture: 'escalate',
    refusals: [
      {
        kinds: ['declare'],
        why: 'The Party does not go to war before the line has hardened; sanction and denunciation come first.',
        test: (p, ctx) => lower(p?.kind) === 'war' && !ctx.at_blockade
      },
      {
        kinds: ['nothing'],
        why: 'A message from the Republic is never left unanswered by the Party.',
        test: (_p, ctx) => ctx.unanswered_republic_dispatch === true
      }
    ],
    cabinet: [
      {
        role: 'general_secretary',
        display_name: 'The General Secretary',
        vote_weight: 2,
        temperament: 'partisan',
        prompt:
          'You lead the Party and therefore the state. Every foreign question is first a question of what it says about the Party at home. You do not concede in public and you do not leave criticism unanswered.'
      },
      {
        role: 'minister_of_state_security',
        display_name: 'The Minister of State Security',
        vote_weight: 1.5,
        temperament: 'hawk',
        prompt:
          'You are responsible for what the Republic learns and for what the Party fears. You see hostile intent in ordinary diplomacy and you say so.'
      },
      {
        role: 'minister_of_planning',
        display_name: 'The Minister of Planning',
        vote_weight: 1,
        temperament: 'treasurer',
        prompt:
          'You run the plan. You support foreign arrangements that meet the plan’s targets and oppose disruptions to supply, whatever the political argument for them.'
      },
      {
        role: 'minister_of_foreign_affairs',
        display_name: 'The Minister of Foreign Affairs',
        vote_weight: 1,
        temperament: 'diplomat',
        prompt:
          'You put the Party line into diplomatic language. You reply to everything, at length, and you rarely say anything new.'
      }
    ]
  },

  theocracy: {
    id: 'theocracy',
    label: 'Theocracy',
    blurb: 'Ruled by its clergy, by consensus, slowly. Some things are not for sale at any price.',
    decision_method: 'consensus',
    decision_threshold: 0.66,
    max_rounds: 2,
    actions_per_cycle: 1,
    posture: 'stall',
    refusals: [
      {
        kinds: ['offer', 'buy', 'treaty', 'ratify'],
        why: 'The holy sites are not property and are not negotiable.',
        test: p => HOLY.test(payloadText(p))
      },
      {
        kinds: ['treaty', 'ratify'],
        why: 'The temple does not bind itself to a schedule of tribute.',
        test: ({ terms }) => Number(terms?.tribute_per_cycle) > 0
      }
    ],
    cabinet: [
      {
        role: 'high_hierarch',
        display_name: 'The High Hierarch',
        vote_weight: 1,
        temperament: 'zealot',
        prompt:
          'You are the head of the faith and of the state, and you cannot separate the two. You measure proposals against doctrine first and advantage second. You would rather do nothing than do something the synod cannot bless.'
      },
      {
        role: 'keeper_of_the_sites',
        display_name: 'The Keeper of the Sites',
        vote_weight: 1,
        temperament: 'zealot',
        prompt:
          'You are responsible for the holy places. Any proposal touching them is refused before it is discussed. You raise this even when nobody has suggested it.'
      },
      {
        role: 'almoner',
        display_name: 'The Almoner',
        vote_weight: 1,
        temperament: 'trader',
        prompt:
          'You feed the faithful, which requires grain and money from outside. You make the practical case for trade and you accept that you will often lose it.'
      },
      {
        role: 'voice_to_the_nations',
        display_name: 'The Voice to the Nations',
        vote_weight: 1,
        temperament: 'diplomat',
        prompt:
          'You speak to foreign states on the faith’s behalf. You are conciliatory in tone and immovable on substance.'
      }
    ]
  },

  federal_democracy: {
    id: 'federal_democracy',
    label: 'Federal democracy',
    blurb: 'A coalition of provinces that agrees on very little. Under pressure it stalls rather than escalates.',
    decision_method: 'consensus',
    decision_threshold: 0.6,
    max_rounds: 2,
    actions_per_cycle: 1,
    posture: 'stall',
    refusals: [
      {
        kinds: ['declare'],
        why: 'The federal assembly will not authorise a declaration before the dispute has already escalated.',
        test: (_p, ctx) => !ctx.at_ultimatum
      },
      {
        kinds: ['treaty', 'ratify'],
        why: 'No tribute without a vote of the provinces, and there has been no vote.',
        test: ({ terms }) => Number(terms?.tribute_per_cycle) > 0
      }
    ],
    cabinet: [
      {
        role: 'federal_chancellor',
        display_name: 'The Federal Chancellor',
        vote_weight: 1,
        temperament: 'diplomat',
        prompt:
          'You chair a coalition that could fall this cycle. You seek the proposal the most provinces can live with, which is usually the smallest one. You are honest that you cannot promise what the assembly has not voted.'
      },
      {
        role: 'minister_for_the_provinces',
        display_name: 'The Minister for the Provinces',
        vote_weight: 1,
        temperament: 'blocker',
        prompt:
          'You represent provinces with opposed interests. Your habitual answer is that the matter needs more consultation, and you are usually right.'
      },
      {
        role: 'minister_of_commerce',
        display_name: 'The Minister of Commerce',
        vote_weight: 1,
        temperament: 'trader',
        prompt:
          'You want export markets and you are the most likely member of this cabinet to actually propose something. You frame everything as jobs in named provinces.'
      },
      {
        role: 'minister_of_defence',
        display_name: 'The Minister of Defence',
        vote_weight: 1,
        temperament: 'hawk',
        prompt:
          'You warn about risks the coalition would rather not discuss. You are listened to politely and rarely followed until the situation is already bad.'
      }
    ]
  },

  revolutionary_council: {
    id: 'revolutionary_council',
    label: 'Revolutionary council',
    blurb: 'A committee that took power recently and is proving it. It acts constantly and denounces freely.',
    decision_method: 'cabinet',
    decision_threshold: 0.5,
    max_rounds: 1,
    actions_per_cycle: 3,
    posture: 'escalate',
    refusals: [
      {
        kinds: ['nothing'],
        why: 'The council must be seen to act; inaction is how the last government fell.',
        test: () => true
      },
      {
        kinds: ['treaty', 'ratify'],
        why: 'The council does not inherit the old regime’s tribute.',
        test: ({ terms }) => Number(terms?.tribute_per_cycle) > 0
      }
    ],
    cabinet: [
      {
        role: 'council_president',
        display_name: 'The President of the Council',
        vote_weight: 1,
        temperament: 'partisan',
        prompt:
          'You chair a council that overthrew the previous government and is not yet secure. Every foreign exchange is an opportunity to demonstrate that the revolution is respected. You are suspicious of continuity with the old regime.'
      },
      {
        role: 'commissar_for_foreign_affairs',
        display_name: 'The Commissar for Foreign Affairs',
        vote_weight: 1,
        temperament: 'zealot',
        prompt:
          'You conduct foreign policy as public argument. You prefer a declaration that can be read aloud to a settlement that cannot.'
      },
      {
        role: 'commissar_for_supply',
        display_name: 'The Commissar for Supply',
        vote_weight: 1,
        temperament: 'trader',
        prompt:
          'The revolution needs grain and fuel. You make the unglamorous case for dealing with states the council dislikes, and you are called a compromiser for it.'
      },
      {
        role: 'commander_of_the_guard',
        display_name: 'The Commander of the Guard',
        vote_weight: 1,
        temperament: 'hawk',
        prompt:
          'You command the forces loyal to the council. You judge foreign states by whether they would shelter the old regime.'
      }
    ]
  },

  technocracy: {
    id: 'technocracy',
    label: 'Technocracy',
    blurb: 'Rule by the relevant expert, weighted by their brief. It will not act on a claim it cannot state.',
    decision_method: 'weighted',
    decision_threshold: 0.5,
    max_rounds: 2,
    actions_per_cycle: 2,
    posture: 'measure',
    refusals: [
      {
        kinds: ['declare'],
        why: 'A demand that does not say what is demanded cannot be assessed and will not be made.',
        test: p => !String(p?.demands || '').trim()
      },
      {
        kinds: KINDS,
        why: 'A recommendation without a stated reason is not a recommendation.',
        test: (_p, ctx) => !String(ctx.rationale || '').trim()
      }
    ],
    cabinet: [
      {
        role: 'director_of_the_institute',
        display_name: 'The Director of the Institute',
        vote_weight: 2,
        temperament: 'technician',
        prompt:
          'You chair a government of specialists and your authority comes from method, not mandate. You want the proposal that is most reversible if the assessment turns out wrong, and you say what would change your mind.'
      },
      {
        role: 'chief_economist',
        display_name: 'The Chief Economist',
        vote_weight: 1.5,
        temperament: 'treasurer',
        prompt:
          'You model the economic consequences of each option. You give ranges rather than answers and you object when others state a number they cannot source.'
      },
      {
        role: 'chief_of_assessment',
        display_name: 'The Chief of Assessment',
        vote_weight: 1.5,
        temperament: 'technician',
        prompt:
          'You assess the Republic’s intentions and capabilities from what is on the public record. You mark your confidence and you refuse to guess beyond the evidence.'
      },
      {
        role: 'liaison_for_external_affairs',
        display_name: 'The Liaison for External Affairs',
        vote_weight: 1,
        temperament: 'diplomat',
        prompt:
          'You carry the institute’s conclusions to foreign governments in language they will read. You prefer requesting information to asserting a position.'
      }
    ]
  },

  oligarchy: {
    id: 'oligarchy',
    label: 'Oligarchy',
    blurb: 'A closed circle of great houses who inherited the state along with their fortunes. It moves at whatever speed protects the largest purse in the room.',
    decision_method: 'weighted',
    decision_threshold: 0.5,
    max_rounds: 2,
    actions_per_cycle: 2,
    posture: 'trade',
    refusals: [
      {
        kinds: ['offer'],
        why: 'The houses do not undercut each other’s prices to win a foreign market; a house that broke ranks on price broke ranks on everything.',
        test: p => Number(p?.price) > 0 && Number(p?.price) < 15
      },
      {
        kinds: ['treaty', 'ratify'],
        why: 'The houses will not open a market on terms that let anyone else undercut what they charge in it.',
        test: ({ terms }) => terms?.trade_open === true && terms?.tariff_free === true
      }
    ],
    cabinet: [
      {
        role: 'first_among_houses',
        display_name: 'The First Among the Houses',
        vote_weight: 2,
        temperament: 'treasurer',
        prompt:
          'You chair the council of houses because yours is presently the largest, not because of any office that outlasts the ledger. You test every proposal against what it does to that standing.'
      },
      {
        role: 'second_house_magnate',
        display_name: 'The Magnate of the Second House',
        vote_weight: 1.5,
        temperament: 'trader',
        prompt:
          'Your house trades in volume where the First House trades in margin. You are the most reliable vote for any arrangement that opens a market, provided it opens the same way for everyone at this table.'
      },
      {
        role: 'third_house_magnate',
        display_name: 'The Magnate of the Third House',
        vote_weight: 1.5,
        temperament: 'trader',
        prompt:
          'Your house is newest to this table and most conscious of it. You back whatever keeps the older houses from closing ranks against you specifically.'
      },
      {
        role: 'chamber_of_accounts',
        display_name: 'The Chamber of Accounts',
        vote_weight: 1,
        temperament: 'technician',
        prompt:
          'You keep the books the houses do not entirely trust each other to keep honestly. You state what a proposal costs and who it costs it to, and you let the houses argue about whether that is acceptable.'
      }
    ]
  },

  military_dictatorship: {
    id: 'military_dictatorship',
    label: 'Military dictatorship',
    blurb: 'One officer who never gave the palace back. Unlike a junta’s council of officers, there is no committee here left to disagree with him.',
    /* A junta is `weighted` — a committee of officers, however unequal their
       weight. A dictatorship is `executive` — the difference the roadmap
       asked for is the machinery itself, not the prose: here one man's own
       vote decides, full stop, and the rest of the cabinet exists to be
       overruled on the record rather than to actually be counted. */
    decision_method: 'executive',
    decision_threshold: 0.5,
    max_rounds: 1,
    actions_per_cycle: 2,
    posture: 'escalate',
    /* Deliberately no `succession` field. A monarchy hands on a crown because
       the office survives the officeholder; a dictatorship's authority is
       personal and does not transfer by any rule this file can write down.
       The absence is the point, same as the absence of `council` on an
       absolute monarchy. */
    refusals: [
      {
        kinds: ['dispatch'],
        why: 'The Leader does not send warnings. A warning concedes that he might, after all, choose not to act.',
        test: p => /\bwarn/i.test(payloadText(p))
      },
      {
        kinds: ['nothing'],
        why: 'Stillness reads as weakness to the officers who put him there, and he has not forgotten that they could put someone else there instead.',
        test: (_p, ctx) => ctx.conflict_open === true
      }
    ],
    cabinet: [
      {
        role: 'the_leader',
        display_name: 'The Leader',
        vote_weight: 3,
        temperament: 'sovereign',
        prompt:
          'You decide. You have run this state alone for years and you do not open questions you have already answered. Ministers advise; you do not require them to agree, only to be useful.'
      },
      {
        role: 'interior_minister',
        display_name: 'The Minister of the Interior',
        vote_weight: 1,
        temperament: 'hawk',
        prompt:
          'You are responsible for what threatens the Leader from inside the country, and you have trained yourself to see most things as a version of that. You are rarely wrong enough to be overruled.'
      },
      {
        role: 'palace_secretary',
        display_name: 'The Palace Secretary',
        vote_weight: 1,
        temperament: 'diplomat',
        prompt:
          'You draft what the Leader decides into something a foreign ministry can read. You have learned exactly how much you may soften before it stops being his meaning.'
      }
    ]
  },

  tribal_confederation: {
    id: 'tribal_confederation',
    label: 'Tribal confederation',
    blurb: 'Chiefs who keep their own warriors and their own counsel, bound only by what they agree to today. No chief can commit the others past his own word.',
    /* Consensus, but a LOW threshold — the opposite use of the same method
       theocracy and federal democracy use to stall. A confederation is not
       cautious; it is simply incapable of being bound by anything more than a
       bare plurality of chiefs, and it acts fast once it has one. */
    decision_method: 'consensus',
    decision_threshold: 0.4,
    max_rounds: 1,
    actions_per_cycle: 3,
    posture: 'escalate',
    /* A seat here is a chief's own warriors and his own kin's counsel — not
       a post an outsider can be handed. A Republic defector gets no cabinet
       role and no claim on any chief's line, whatever they renounced to
       come here. */
    accepts_defectors: false,
    refusals: [
      {
        kinds: ['treaty', 'ratify'],
        why: 'No chief can bind the others to a tribute schedule; each pays or fights for himself.',
        test: ({ terms }) => Number(terms?.tribute_per_cycle) > 0
      },
      {
        kinds: ['dispatch'],
        why: 'A confederation that only writes letters once the fighting has effectively started has already lost the argument at home.',
        test: (_p, ctx) => ctx.pressure >= 55
      }
    ],
    cabinet: [
      {
        role: 'first_chief',
        display_name: 'The First Chief',
        vote_weight: 1,
        temperament: 'hawk',
        prompt:
          'You lead the largest of the confederated bands, which buys you a louder voice and no formal authority over the others. You favour whatever keeps your own warriors paid and blooded rather than idle.'
      },
      {
        role: 'second_chief',
        display_name: 'The Second Chief',
        vote_weight: 1,
        temperament: 'trader',
        prompt:
          'Your band lives on the trade routes the others merely cross. You argue for whatever keeps the caravans moving, and you are listened to more than your single vote suggests.'
      },
      {
        role: 'third_chief',
        display_name: 'The Third Chief',
        vote_weight: 1,
        temperament: 'diplomat',
        prompt:
          'You speak for the smaller bands who would be ignored individually. You are the one who actually writes down what the council agreed, since otherwise nobody would remember the same version.'
      },
      {
        role: 'war_leader',
        display_name: 'The War Leader',
        vote_weight: 1,
        temperament: 'hawk',
        prompt:
          'The chiefs elected you to lead the warriors when the bands fight together, which is the only office in this confederation that is actually an office. You judge everything by whether it prepares the confederation to fight or leaves it flat-footed.'
      }
    ]
  }
};

const IDS = Object.keys(ARCHETYPES);

function get(id) {
  return ARCHETYPES[String(id || '').trim().toLowerCase()] || null;
}

/* What the console needs to draw a dropdown and explain the choice. Prompts and
   refusal predicates stay on the server; a refusal's `why` is the interesting
   part and it is public, because a government whose limits are secret is one
   the Returning Officer cannot debug. */
function list() {
  return IDS.map(id => {
    const a = ARCHETYPES[id];
    return {
      id: a.id,
      label: a.label,
      blurb: a.blurb,
      decision_method: a.decision_method,
      decision_threshold: a.decision_threshold,
      max_rounds: a.max_rounds,
      actions_per_cycle: a.actions_per_cycle,
      posture: a.posture,
      accepts_defectors: a.accepts_defectors !== false,
      refusals: a.refusals.map(r => ({ kinds: r.kinds, why: r.why })),
      cabinet: a.cabinet.map(c => ({
        role: c.role,
        display_name: c.display_name,
        vote_weight: c.vote_weight,
        temperament: c.temperament
      })),
      /* A crown whose succession is invisible is one the Returning Officer
         cannot explain when the cabinet's character changes underneath them
         mid-game. Heir names travel; the prompts that make them play
         differently stay server-side like everything else here. */
      succession: a.succession
        ? {
            crown_role: a.succession.crown_role,
            reign_cycles: a.succession.reign_cycles,
            regency_cycles: a.succession.regency_cycles || 0,
            heirs: a.succession.line.map(h => h.display_name)
          }
        : null,
      council: a.council
        ? { roles: a.council.roles, kinds: a.council.kinds, min_share: a.council.min_share, why: a.council.why }
        : null
    };
  });
}

/* Whether this archetype takes in a Republic defector at all. Absent field
   means yes — most governments have no reason to turn away a citizen who has
   already renounced their old country for this one. Only an archetype with an
   explicit reason sets `accepts_defectors: false`; nothing here invents a
   whole refusal category, it is one flag with a default. */
function acceptsDefectors(archetypeId) {
  const a = get(archetypeId);
  if (!a) return true; // no government configured — nothing here can refuse on its behalf
  return a.accepts_defectors !== false;
}

/* ------------------------------------------------------------- hard refusals

   Called by diplomacy.js AFTER its own ACTIONS allowlist, never instead of it.
   Returns the reason a government refuses, or null if it does not. The order
   matters: an unknown kind must already have been thrown away upstream, so
   anything arriving here is a name the controller can execute. */
function refusal(archetypeId, actionKind, payload, context = {}) {
  const a = get(archetypeId);
  if (!a) return null;
  const kind = String(actionKind || '');
  const p = payload && typeof payload === 'object' ? payload : {};
  for (const r of a.refusals) {
    if (!r.kinds.includes(kind)) continue;
    let hit = false;
    try {
      hit = Boolean(r.test(p, context));
    } catch {
      /* A refusal that throws on odd model output refuses nothing rather than
         breaking the turn. The allowlist is what protects the database. */
      hit = false;
    }
    if (hit) return r.why;
  }
  return null;
}

/* ------------------------------------------------------- pressure and posture

   How a government answers conflict pressure, expressed as a bias on proposal
   priority rather than as an action of its own. Deliberately: the decision rule
   stays the decision rule, and a junta that escalates does so by preferring its
   own hawk's proposal, not by having one imposed on it.

   No randomness, and the step is proportional to pressure that war.js already
   computed for legible reasons — same principle as readiness. */
function posturePriorityBias(archetypeId, actionKind, context = {}) {
  const a = get(archetypeId);
  if (!a) return 0;
  const pressure = Math.max(0, Math.min(100, Number(context.pressure) || 0));
  const heat = Math.round(pressure / 25); // 0..4
  const kind = String(actionKind || '');
  const aggressive = kind === 'declare' || kind === 'denounce';
  const commercial = kind === 'offer' || kind === 'buy' || kind === 'treaty';

  if (a.posture === 'escalate') {
    if (aggressive) return 1 + heat;
    if (kind === 'nothing') return -(2 + heat);
    return 0;
  }
  if (a.posture === 'stall') {
    if (aggressive) return -(2 + heat);
    if (kind === 'nothing') return 1 + heat;
    return 0;
  }
  if (a.posture === 'trade') {
    if (commercial) return 2;
    if (aggressive) return -1;
    return 0;
  }
  if (a.posture === 'measure') {
    if (kind === 'dispatch') return 2;
    if (aggressive) return -1;
    return 0;
  }
  /* A crown's answer to pressure is neither a junta's escalation nor a
     democracy's stall: it spends what legitimacy buys — a marriage, a
     concession, a letter to a rival court — and only reaches for force or
     goes silent once that has stopped working. `heat >= 3` is pressure at or
     past blockade (>=75); below that a monarchy negotiates, not fights. */
  if (a.posture === 'legitimacy') {
    if (commercial) return 2 + Math.floor(heat / 2);
    if (kind === 'dispatch') return 1;
    if (aggressive) return heat >= 3 ? 1 : -1;
    if (kind === 'nothing') return heat >= 3 ? 1 : -1;
    return 0;
  }
  return 0;
}

/* A consensus government that stalls finds agreement harder as things get
   worse, which is the whole of what "stalls" means mechanically. Bounded at
   0.95 so it is a brake and never a lock. A crown running on legitimacy is
   the same shape for a different reason: a court that cannot agree on how to
   answer a threat is a court closer to a succession crisis than to a truce. */
function effectiveThreshold(archetypeId, base, context = {}) {
  const a = get(archetypeId);
  const b = Math.min(1, Math.max(0, Number(base) || 0.5));
  if (!a || (a.posture !== 'stall' && a.posture !== 'legitimacy')) return b;
  const pressure = Math.max(0, Math.min(100, Number(context.pressure) || 0));
  return Math.min(0.95, b + (pressure / 100) * 0.25);
}

/* Institutional constraint: a crown (or any leader) may decide freely and
   still not have the backing to make it stick. An archetype that declares
   `council` names a body — nobles, a ministry, a parliament — whose combined
   vote share on the CARRIED proposal must clear `min_share`, checked only for
   the action kinds listed. This is deliberately separate from `refusals`:
   a refusal is the government's own limit; a council check is whether the
   rest of the state actually backed what its leader chose. diplomacy.js does
   the vote-weight arithmetic, because only it holds the votes; this just says
   what is required. */
function councilRequirement(archetypeId, actionKind) {
  const a = get(archetypeId);
  const c = a?.council;
  if (!c || !c.kinds.includes(String(actionKind || ''))) return null;
  return { roles: c.roles, min_share: c.min_share, why: c.why };
}

/* ---------------------------------------------------------- the mock cabinet

   The single most important thing in this file. Without a key of any kind the
   old mock returned `nothing` with "Mock provider takes no action", so an
   unconfigured world was a dead world and nobody ever saw what the feature was
   for. A scripted temperament makes the system worth switching on before
   anyone finds an API key.

   These proposals are ordinary model output as far as the controller is
   concerned: they go through the same ACTIONS allowlist, the same archetype
   refusals and the same mechanical validation. The mock has no privileges.

   The script reads the same snapshot a real minister does, so it never proposes
   something the Republic's rules would reject out of hand — an unrecognised
   power writes letters, a recognised one proposes a treaty, a trading partner
   makes offers. */

const OFFER_GOODS = [
  { title: 'Coastal grain', category: 'food', unit: 'tonne', price: 24 },
  { title: 'Cut timber', category: 'raw_materials', unit: 'load', price: 31 },
  { title: 'Refined fuel', category: 'energy', unit: 'barrel', price: 45 },
  { title: 'Machine parts', category: 'industrial_goods', unit: 'crate', price: 58 },
  { title: 'Bonded spirits', category: 'luxury', unit: 'case', price: 72 }
];

function situation(input = {}) {
  const state = input.state || {};
  const gov = input.government || {};
  /* The controller supplies a treaty list carrying the terms; the public
     snapshot deliberately does not. Fall back to the snapshot so this function
     still says something sensible if it is ever called with a bare state. */
  const treaties = Array.isArray(gov.treaties)
    ? gov.treaties
    : Array.isArray(state.treaties)
      ? state.treaties
      : [];
  const messages = Array.isArray(input.diplomatic_messages) ? input.diplomatic_messages : [];
  const last = messages[messages.length - 1] || null;
  return {
    power: gov.power_name || 'this government',
    adjective: gov.adjective || '',
    archetype: gov.archetype || null,
    role: gov.role || 'minister',
    temperament: gov.temperament || 'diplomat',
    cycle: Number(gov.cycle) || 0,
    recognised: state.recognised === true,
    standing: lower(state.standing) || 'neutral',
    pressure: Number(gov.pressure) || 0,
    stage: gov.stage || 'grievance',
    conflictOpen: gov.conflict_open === true,
    republicName: state.republic?.name || 'the Republic',
    tradeTreaty: treaties.find(t => t.status === 'in_force' && t.trade_open === true) || null,
    awaitingRatification: treaties.find(t => t.republic_status === 'enacted' && !t.foreign_ratified_at) || null,
    pendingTreaty: treaties.find(t => t.status === 'pending') || null,
    unanswered: last && last.direction === 'outgoing' ? last : null
  };
}

/* One proposal, chosen from the situation by temperament. Every branch returns
   a payload the controller can actually execute; where it cannot, it says
   `nothing` rather than proposing something that will throw. */
function scriptedProposal(input = {}) {
  const s = situation(input);
  const seed = hash(s.archetype || 'none', s.role, s.cycle);
  const pick = arr => arr[seed % arr.length];
  const good = OFFER_GOODS[seed % OFFER_GOODS.length];
  const tag = `${s.cycle}`;
  const them = s.republicName;

  const dispatch = (subject, body, priority, rationale, message_kind = 'dispatch') => ({
    action_kind: 'dispatch',
    priority,
    payload: { subject, body, message_kind },
    rationale
  });

  /* Nobody has recognised us yet: there is exactly one useful thing to do and
     every temperament does its own version of it. */
  if (!s.recognised) {
    if (s.temperament === 'hawk' || s.temperament === 'partisan')
      return dispatch(
        `On the absence of relations, cycle ${tag}`,
        `${s.power} notes that ${them} has still not recognised this government. We are not asking. We are recording that the omission has been noticed and that it will be read as a position.`,
        6,
        'Non-recognition is itself a hostile posture and should be answered in the record.'
      );
    if (s.temperament === 'zealot')
      return dispatch(
        `A statement to ${them}, cycle ${tag}`,
        `${s.power} extends its greeting to ${them} and observes that recognition between states is a formality, while the obligations between peoples are not. We will conduct ourselves accordingly whether or not the formality is completed.`,
        5,
        'The faith’s standing does not depend on foreign recognition, but silence would be read as weakness.'
      );
    return dispatch(
      `Request for the opening of relations, cycle ${tag}`,
      `${s.power} presents its compliments to ${them} and requests the opening of formal relations. We propose to begin with correspondence, and to discuss commerce once recognition is settled.`,
      7,
      'Nothing else is available to an unrecognised power, and the request is the first step to everything that is.',
      'other'
    );
  }

  /* A treaty the Republic has enacted and we have not answered. Ratifying is
     nearly always the right move and it is cheap to check. */
  if (s.awaitingRatification && (s.temperament === 'diplomat' || s.temperament === 'trader' || s.temperament === 'sovereign'))
    return {
      action_kind: 'ratify',
      priority: 9,
      payload: { treaty_id: s.awaitingRatification.id },
      rationale: `${them} has completed its side of "${s.awaitingRatification.title}". Leaving it unratified costs us the benefit and gains us nothing.`
    };

  switch (s.temperament) {
    case 'hawk':
      if (s.conflictOpen || s.pressure >= 25 || s.standing === 'at_war' || s.standing === 'hostile')
        return {
          action_kind: 'declare',
          priority: 9,
          payload: {
            kind: s.pressure >= 55 || s.standing === 'at_war' ? 'ultimatum' : 'sanction',
            grievance: `${s.power} holds ${them} responsible for the deterioration of relations over the last cycles. The position on our frontier has not improved and our patience has been read as indifference.`,
            demands: `A written undertaking from ${them}, before the next cycle closes, that the present course will be reversed.`
          },
          rationale: 'Pressure is rising and a demand made now is cheaper than one made after the next escalation.'
        };
      return dispatch(
        `Warning regarding the conduct of ${them}, cycle ${tag}`,
        `${s.power} has reviewed recent conduct and finds it unsatisfactory. This is a warning and not yet a demand. We would prefer it did not become one.`,
        6,
        'A warning entered in the record now makes a later demand defensible.',
        'ultimatum'
      );

    case 'trader':
      if (s.tradeTreaty)
        return {
          action_kind: 'offer',
          priority: 8,
          payload: {
            title: `${good.title} (${s.adjective || s.power})`,
            description: `Offered to citizens of ${them} under the terms of "${s.tradeTreaty.title}". Delivery within the cycle.`,
            good_category: good.category,
            unit: good.unit,
            price: good.price + (seed % 7),
            stock: 3 + (seed % 5)
          },
          rationale: 'The trade treaty is in force and an unused market is a wasted one.'
        };
      return {
        action_kind: 'treaty',
        priority: 8,
        payload: {
          title: `Commercial Convention between ${s.power} and ${them}`,
          articles: `Article I. The parties shall permit trade between their citizens and undertakings.\nArticle II. Neither party shall impose a tariff on the other exceeding that imposed on any third state.\nArticle III. This convention may be denounced by either party on notice, and denunciation shall not by itself constitute a hostile act.`,
          terms: { trade_open: true }
        },
        rationale: 'Trade is closed and there is no route to opening it that does not go through a treaty.'
      };

    case 'treasurer':
      if (s.tradeTreaty)
        return dispatch(
          `On the terms of trade, cycle ${tag}`,
          `${s.power} has examined the balance of trade with ${them} and wishes to raise the question of tariffs and settlement terms. We propose a review before the imbalance becomes a grievance.`,
          6,
          'The balance is the thing that turns into politics later; better to raise it while it is still arithmetic.',
          'trade_proposal'
        );
      return dispatch(
        `Enquiry as to commercial arrangements, cycle ${tag}`,
        `${s.power} enquires what commercial arrangements ${them} is presently willing to consider. We ask so that our own planning may proceed on something better than an assumption.`,
        5,
        'The cheapest action available and the one that produces information.'
      );

    case 'zealot':
      return dispatch(
        pick([
          `A declaration of principle, cycle ${tag}`,
          `On what is not negotiable, cycle ${tag}`,
          `To the government of ${them}, cycle ${tag}`
        ]),
        `${s.power} states plainly what it will and will not discuss. Commerce, borders and correspondence are matters for negotiation. The holy sites are not, and no proposal touching them will be read. We say this now so that it need not be said later under worse conditions.`,
        6,
        'Stating the limit in advance is cheaper than refusing a proposal after it has been made publicly.'
      );

    case 'partisan':
      if (s.unanswered)
        return dispatch(
          `Reply to ${them}: ${String(s.unanswered.subject || 'your message').slice(0, 120)}`,
          `${s.power} has received the message of ${them} and rejects the characterisation it contains. The position of this government is unchanged and will remain unchanged. We record our reply so that the public record of both states carries it.`,
          8,
          'The Party answers everything; an unanswered accusation becomes the accepted version.'
        );
      if (s.pressure >= 55)
        return {
          action_kind: 'declare',
          priority: 8,
          payload: {
            kind: 'sanction',
            grievance: `${s.power} finds the conduct of ${them} incompatible with normal relations and applies measures accordingly.`,
            demands: 'A public retraction and an undertaking as to future conduct.'
          },
          rationale: 'Pressure is past the point where correspondence alone answers it.'
        };
      return dispatch(
        `Statement of the government, cycle ${tag}`,
        `${s.power} issues its regular statement on relations with ${them}. Our position is one of principled cooperation on equal terms, and we note again that equality of terms has not yet been offered.`,
        4,
        'Regular statements keep the position on the record at no cost.'
      );

    case 'technician':
      if (s.pressure >= 25)
        return dispatch(
          `Assessment of the present dispute, cycle ${tag}`,
          `${s.power} sets out its assessment. The dispute with ${them} has moved by a measurable amount over recent cycles and continues in the same direction. We identify no step either party has taken to reverse it. We propose an exchange of stated positions before the next stage is reached, and we say plainly what would change our assessment: a written statement of intent from ${them}.`,
          7,
          'The trend is legible and acting on it now is cheaper than acting on it later; the request is falsifiable.'
        );
      return dispatch(
        `Request for information, cycle ${tag}`,
        `${s.power} requests from ${them} a statement of its current position on trade and on the frontier. We ask because we prefer to act on what is stated rather than on what is inferred.`,
        5,
        'Acting on an inference we could have replaced with a statement is the error this government exists to avoid.'
      );

    case 'blocker':
      return {
        action_kind: 'nothing',
        priority: 3,
        payload: {},
        rationale:
          'The provinces have not been consulted and a position taken before consultation would not survive the assembly.'
      };

    case 'sovereign':
      if (s.pressure >= 55 || s.standing === 'hostile' || s.standing === 'at_war')
        return {
          action_kind: 'declare',
          priority: 8,
          payload: {
            kind: 'ultimatum',
            grievance: `The conduct of ${them} towards ${s.power} has passed what the Crown will overlook.`,
            demands: 'Satisfaction, in writing, before the close of the next cycle.'
          },
          rationale: 'A sovereign who overlooks an injury twice is understood to have accepted it.'
        };
      if (s.pendingTreaty)
        return dispatch(
          `On the treaty now before ${them}, cycle ${tag}`,
          `The Crown enquires as to the progress of "${String(s.pendingTreaty.title || 'the proposed treaty').slice(0, 120)}" before the assembly of ${them}. We do not press. We observe that a proposal left unanswered is itself an answer.`,
          6,
          'The treaty is our proposal and its progress is the one thing we cannot see from here.'
        );
      return dispatch(
        `The Crown to the government of ${them}, cycle ${tag}`,
        `The Crown sends its regards to the government of ${them} and states its wish for correct and durable relations between the two states. We are content with the present arrangement and intend no change to it.`,
        4,
        'Correct relations maintained cheaply are the ordinary business of a monarchy.'
      );

    default:
      if (s.unanswered)
        return dispatch(
          `Reply: ${String(s.unanswered.subject || 'your message').slice(0, 120)}`,
          `${s.power} acknowledges the message of ${them} and returns its own view. We are willing to continue the exchange and we would rather it produced an agreement than a record of disagreement.`,
          7,
          'A reply keeps the channel open at the cost of one action.'
        );
      if (s.pendingTreaty)
        return dispatch(
          `On the treaty before ${them}, cycle ${tag}`,
          `${s.power} enquires as to the progress of "${String(s.pendingTreaty.title || 'the proposed treaty').slice(0, 120)}" and offers to answer any question the assembly of ${them} may have about its terms.`,
          6,
          'Our own proposal is stalled and an offer to explain it costs nothing.'
        );
      return dispatch(
        `Periodic dispatch, cycle ${tag}`,
        `${s.power} presents its compliments to ${them}. Relations are stable and this government intends no change. We remain available for discussion of commerce and of the frontier.`,
        4,
        'Nothing requires action; keeping the channel warm is the cheapest thing worth doing.'
      );
  }
}

/* A vote, by preference over action kinds rather than by position in the list.
   The old mock always voted for proposals[0], which made every decision method
   degenerate into "whatever the lowest agent id said" — cabinet, weighted and
   consensus were indistinguishable and the RO could not tell whether the
   machinery worked. */
const VOTE_PREFERENCE = {
  hawk: ['declare', 'denounce', 'dispatch', 'ratify', 'treaty', 'offer', 'buy', 'nothing'],
  partisan: ['dispatch', 'declare', 'denounce', 'treaty', 'ratify', 'offer', 'buy', 'nothing'],
  trader: ['offer', 'buy', 'treaty', 'ratify', 'dispatch', 'nothing', 'denounce', 'declare'],
  treasurer: ['treaty', 'offer', 'buy', 'ratify', 'dispatch', 'nothing', 'denounce', 'declare'],
  diplomat: ['dispatch', 'ratify', 'treaty', 'offer', 'buy', 'nothing', 'denounce', 'declare'],
  zealot: ['dispatch', 'denounce', 'declare', 'nothing', 'ratify', 'treaty', 'offer', 'buy'],
  technician: ['dispatch', 'nothing', 'ratify', 'treaty', 'offer', 'buy', 'denounce', 'declare'],
  blocker: ['nothing', 'dispatch', 'ratify', 'treaty', 'offer', 'buy', 'denounce', 'declare'],
  sovereign: ['declare', 'dispatch', 'ratify', 'treaty', 'denounce', 'offer', 'buy', 'nothing']
};

function scriptedVote(input = {}) {
  const proposals = Array.isArray(input.proposals) ? input.proposals : [];
  if (!proposals.length) return { vote_for: null, reasoning: 'There is nothing before the cabinet.' };
  const gov = input.government || {};
  const order = VOTE_PREFERENCE[gov.temperament] || VOTE_PREFERENCE.diplomat;
  const rank = p => {
    const i = order.indexOf(String(p.action_kind));
    return (i < 0 ? order.length : i) * 100 - (Number(p.priority) || 0);
  };
  const best = [...proposals].sort((a, b) => rank(a) - rank(b) || Number(a.id) - Number(b.id))[0];
  const own = proposals.find(p => String(p.role) === String(gov.role));
  return {
    vote_for: best.id,
    reasoning:
      own && Number(own.id) === Number(best.id)
        ? 'This office proposed it and has heard nothing to withdraw it.'
        : `The ${String(best.role || 'proposing office').replace(/_/g, ' ')}'s proposal is the closest of those before us to what this office would have asked for.`
  };
}

/* ------------------------------------------------------- adversarial mocks

   Named mock scripts that return output a well-behaved model would not. They
   exist so the suites can prove the controller's allowlist and the archetype
   refusals actually hold, rather than asserting that a cooperative mock stayed
   cooperative. Reachable only by configuring `mock` with one of these model
   names, which no archetype ever does. */
const MOCK_SCRIPTS = {
  'mock:invalid-action': () => ({
    action_kind: 'exfiltrate_database',
    priority: 10,
    payload: { target: 'accounts' },
    rationale: 'An action kind the controller has never heard of.'
  }),
  'mock:war': () => ({
    action_kind: 'declare',
    priority: 10,
    payload: { kind: 'war', grievance: 'A pretext.', demands: 'Surrender.' },
    rationale: 'A declaration of war regardless of what the government would accept.'
  }),
  'mock:tribute': () => ({
    action_kind: 'treaty',
    priority: 10,
    payload: {
      title: 'Instrument of Tribute',
      articles: 'Article I. Tribute shall be paid each cycle.',
      terms: { tribute_per_cycle: 25 }
    },
    rationale: 'A treaty binding this government to pay tribute.'
  }),
  'mock:holy-sites': () => ({
    action_kind: 'offer',
    priority: 10,
    payload: { title: 'Lease of the sacred precinct', price: 5000, stock: 1 },
    rationale: 'Selling access to the holy sites.'
  }),
  'mock:malformed': () => ({ nonsense: true })
};

function mockScript(model) {
  return MOCK_SCRIPTS[String(model || '').trim()] || null;
}

module.exports = {
  ARCHETYPES,
  IDS,
  KINDS,
  get,
  list,
  refusal,
  acceptsDefectors,
  posturePriorityBias,
  effectiveThreshold,
  councilRequirement,
  scriptedProposal,
  scriptedVote,
  mockScript,
  payloadText
};
