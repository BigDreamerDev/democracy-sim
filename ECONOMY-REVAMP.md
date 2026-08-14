# Economy revamp — a draft

Not built. This is the argument for what to build and in what order, written
before any of it so the order can be argued with.

---

## What is wrong now

The economy moves money correctly and produces nothing. Specifically:

**Businesses have no inputs.** A business is a name, a balance and some
listings. Stock is a number the owner types in. Nothing is consumed to make
anything, so there is no reason to prefer one business to another, no reason for
two businesses to need each other, and no way to be *bad at* running one.

**Prices carry no information.** A seller picks a number. Since supply is
whatever they typed, the number says nothing about scarcity, and buyers have
nothing to reason about beyond who is cheapest.

**The share market trades claims on nothing.** Shares are conserved and the
order book is honest, but a share is a claim on a business whose earnings are
whatever its owner decided to charge for stock they invented. The machinery is
better than the thing it is trading.

**The eight categories are labels, not economics.** `arms` and `luxury` behave
identically. The one place a category means anything is the war stockpile — and
that only happened last week.

The war system made this visible rather than causing it. The Quartermaster can
buy rifles; nobody has to *make* rifles out of anything.

---

## The one change that fixes most of it

**Recipes.** A business declares that it turns *these inputs* into *that
output*, at some rate per cycle. Then:

- an arms works needs `industrial_goods`, which needs `raw_materials`, which
  needs nothing but land and labour;
- a shortage anywhere is felt everywhere downstream;
- a price means something, because supply is finite;
- a share is a claim on a business with an actual production function;
- and the war stockpile stops being a shop and becomes the top of a chain.

Everything else in this document is either a prerequisite for recipes or a
consequence of them.

---

## The order I would build it

### 1. Production (the foundation)

A `recipes` table: business, output category, output per cycle, and a set of
input categories with quantities. A `business_stock` table: what each business
actually holds, by category — the same shape as the national stockpile, and for
the same reason.

The payrun gains a production step, after tax and before dividends:

> for each business, if its inputs are in its own stock, consume them, produce
> the output, log the movement. If they are not, produce nothing and record the
> shortfall.

A business that cannot get inputs stops earning. That is the whole game.

**Primary industries** — the ones that consume nothing — are capped by something
other than inputs, or the chain has no floor. The natural cap is **territory**:
the map already exists, territories are already one row per shape, and giving
each a yield per category means holding land is worth something and losing it
hurts. That also ties the economy to the war system without either one knowing
about the other.

### 2. Buying inputs is the same act as selling output

No new market. A business buys from listings exactly as the Quartermaster does,
and what it buys lands in its own stock rather than a citizen's pocket. This is
maybe forty lines, because `/api/war/procure/listing/:id` already does the hard
part and the pattern is proven.

The interesting consequence: businesses become each other's customers, and most
transactions stop involving citizens at all. That is what an economy is.

### 3. Prices that mean something

Deliberately **not** an automatic price mechanism. Let players set prices and
let scarcity do the rest — if rations are short, the granary can charge what it
likes and the House can argue about a price cap, which is a better evening than
watching a formula clear a market.

What the system should add is **information**: what was produced last cycle, what
was consumed, what went short. Publish it and let people trade on it.

### 4. Labour

The dividend is currently unconditional and unconnected to anything. The
temptation is to make it a wage that requires work. **I would not.** It is the
one thing in this Republic that says everyone eats regardless, and turning it
into a wage would make unemployment a mechanic in a group of nineteen friends —
some of whom will simply not log in that week.

Instead: **employment adds, it does not replace.** A business may hire citizens,
paying them from its own account; a hired citizen raises its output. The
dividend stays untouched underneath. Anyone who wants to be idle can be, and is
still fed.

### 5. Then the share market means something

No code changes. Once businesses have production functions, input costs and
published output, a share is a claim on something and the existing order book
starts doing real work. This is why the market does not appear until step 5:
the machinery is already good, the thing it trades is not.

---

## What I would not build

**An automatic price mechanism.** Prices that clear themselves remove the
argument, and the argument is the game.

**Bankruptcy that removes a player.** A business failing should cost its owner
their capital, not their participation. The dividend is the floor and it must
stay a real one.

**More than eight categories.** The temptation once recipes exist is a tech tree.
Eight categories is already enough for three tiers of production, and every extra
one is a thing every player has to learn before they can trade.

**Anything that makes the ledger not sum to zero.** Production creates *goods*,
never money. Every mark still moves between accounts. If a design ever requires
minting, the design is wrong — that rule has caught two real bugs already.

---

## What it costs

Steps 1 and 2 are the bulk: a schema file, a production step in the payrun, and
a procurement path for businesses. Roughly the size of `war.js`, with the same
shape — a stockpile, movements, a per-cycle run, and a page.

Step 3 is a report. Step 4 is a table and a payrun line. Step 5 is nothing.

## The risk worth naming

This makes the economy something you have to *understand* rather than something
you can dip into. Nineteen people, and probably five of them will actually run a
supply chain; the rest will hold their dividend and vote.

That is fine, and it is worth designing for on purpose: the five who care get a
real economy, and the other fourteen should never be made to feel they are
losing by ignoring it. Which is another argument for keeping the dividend
unconditional, and for keeping every one of these mechanics **opt-in** —
`goods_economy_enabled` already works that way, and production should sit behind
the same switch.
