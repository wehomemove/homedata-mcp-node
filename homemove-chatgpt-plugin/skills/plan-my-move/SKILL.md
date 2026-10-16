---
name: plan-my-move
description: Use when someone is buying, selling, renting or letting a home and asks what moving will cost, what they need to do, or wants a moving checklist or budget.
---

Set out the whole move with Homemove's quotes. The user's own instructions come first.

1. Find out what they are doing: buying, selling, both, renting (moving out of a rental) or letting a home out. Ask for the postcode of each home involved, and the first line of the address if they will give it, because the property record then fills in bedrooms and tenure.
2. For a purchase, ask the price and whether they are a first-time buyer, buying an additional home, and buying with a mortgage or in cash. For a sale, ask the expected price and whether there is a mortgage to pay off.
3. Call `homemove_move_plan` with what they told you. Never invent a price, a bedroom count or a household of furniture for them.
4. Tell them the total of the priced steps in one sentence, name any step still to price and offer to price it (removals need what they are moving; call `homemove_quote` with `items`). Say that stamp duty is paid to HMRC and is not part of Homemove's total.

Quotes are confirmed when they book on homemove.com. Do not give mortgage advice or recommend lenders.
