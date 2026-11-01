// Generated from src/lib/group-core.ts by scripts/build-site.mjs. Do not edit.
// Group Tehillim: the rules for sharing out the 150 perakim. Pure functions with no server code, so
// they can be tested on their own (scripts/test-group.mjs). Each returns the group's next state,
// which src/lib/group-api.ts saves in a transaction, so two people can never get the same perek.

export const PERAKIM = 150;
/** A perek taken and not confirmed goes back to the group after this long. */
export const HOLD_MS = 30 * 60 * 1000;

                                        
                                                  

                     
                   
               
               
                    
                                                                                    
                
                                    
                 
                                                 
                                
                    
                  
  

export function newGroup(purpose         , name        , note        , now        )        {
  return { purpose, name, note, createdAt: now, round: 1, read: [], claims: {}, totalRead: 0, readers: 0 };
}

/** The claims still in force. */
function liveClaims(g       , now        ) {
  return Object.fromEntries(Object.entries(g.claims).filter(([, c]) => c.until > now));
}

export function myPerek(g       , me        , now        )                {
  const mine = Object.entries(liveClaims(g, now)).find(([, c]) => c.by === me);
  return mine ? Number(mine[0]) : null;
}

export function stats(g       , now        ) {
  const read = g.read.length;
  const reading = Object.keys(liveClaims(g, now)).filter((p) => !g.read.includes(Number(p))).length;
  return { read, reading, free: PERAKIM - read - reading, booksDone: g.round - 1, totalRead: g.totalRead, readers: g.readers };
}

/** The first free perek after `after`, going round to the start; never `after` itself. */
function nextFree(g       , claims                 , after        ) {
  for (let i = 1; i <= PERAKIM; i++) {
    const p = ((after + i - 1) % PERAKIM) + 1;
    if (p !== after && !g.read.includes(p) && !claims[p]) return p;
  }
  return null;
}

/** Gives me a perek: the one I already hold, or else the first free one. Null when none is free. */
export function take(g       , me        , now        )                                         {
  const held = myPerek(g, me, now);
  if (held) return { group: g, perek: held };
  const claims = liveClaims(g, now);
  const perek = nextFree(g, claims, 0);
  if (!perek) return { group: { ...g, claims }, perek: null };
  return { group: { ...g, claims: { ...claims, [perek]: { by: me, until: now + HOLD_MS } } }, perek };
}

/** Puts my perek back and gives me the next free one. If no other is free, I keep mine. */
export function swap(g       , me        , now        )                                         {
  const held = myPerek(g, me, now);
  if (!held) return take(g, me, now);
  const claims = liveClaims(g, now);
  const perek = nextFree(g, claims, held);
  if (!perek) return { group: { ...g, claims }, perek: held };
  delete claims[held];
  return { group: { ...g, claims: { ...claims, [perek]: { by: me, until: now + HOLD_MS } } }, perek };
}

/** Puts my perek back for someone else. */
export function release(g       , me        , now        )        {
  const claims = liveClaims(g, now);
  const held = myPerek(g, me, now);
  if (held) delete claims[held];
  return { ...g, claims };
}

/**
 * I finished this perek. It counts even if my hold ran out in the meantime; if someone else has
 * since read it, it isn't marked twice. Reading the last perek starts the next round.
 */
export function finish(g       , me        , perek        , now        )        {
  const claims = liveClaims(g, now);
  if (claims[perek]?.by === me) delete claims[perek];
  const read = g.read.includes(perek) ? g.read : [...g.read, perek];
  const complete = read.length >= PERAKIM;
  return { ...g, claims, read: complete ? [] : read, round: complete ? g.round + 1 : g.round, totalRead: g.totalRead + 1 };
}
