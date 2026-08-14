# Strategic Goods Economy

*Optional mode. War mechanics are deliberately not part of this feature yet.*

Enable with the Republic setting `goods_economy_enabled = true`. The setting is legislatable like the other economy/diplomacy rules. When false, the existing business/listing economy behaves as before.

## What changes when enabled

Every newly founded business chooses one economic category:

- `food`
- `raw_materials`
- `energy`
- `industrial_goods`
- `technology`
- `arms`
- `luxury`
- `services`

The player still freely names the business and every product. The category is only the machine-readable economic meaning. A business called Bob Industries can therefore sell "Extremely Questionable Tank" while the system records it as `arms`.

A listing inherits its business category and also has a free-text unit such as `kg`, `tonne`, `crate`, `vehicle`, `licence`, or simply `unit`. Stock remains the existing listing stock. One purchase currently buys one listing unit; this mode does not introduce recipes or automatic production.

Existing businesses created before the mode was enabled are not broken. Their owners are prompted to classify them before making new strategic-goods listings. Existing listings remain visible.

## Diplomacy integration

Foreign offers use the same eight categories and units. When strategic goods mode is enabled a foreign offer must include a valid `good_category`.

Recognised foreign powers with an in-force `trade_open` treaty can read the domestic market at:

`GET /api/foreign/domestic-listings`

and buy a domestic listing at:

`POST /api/foreign/domestic-listings/:id/buy`

This means an LLM government can reason about and purchase actual player-created goods rather than using a separate foreign-resource system. Domestic businesses receive the export income and the transaction is recorded in the existing foreign trade balance.

Players can likewise buy categorised foreign offers through the existing foreign market. Import tax and treaty requirements are unchanged.

## What this mode does not do yet

It intentionally does not add war consumption, military strength, production recipes, input/output chains, national stockpiles, shortages, or automatic price changes. Those can be built later on top of the categories without changing the existing business model.
