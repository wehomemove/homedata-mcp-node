---
name: what-can-i-afford
description: Use when someone gives their budget as a monthly repayment, a deposit or savings rather than a price ("what could I buy paying 1,600 a month with a 40,000 deposit?") and wants to know the price that fits and see homes for sale at it.
---

Turn a monthly budget into a price, then show homes for sale at that price. Every figure is an estimate from the user's own numbers. The user's own instructions come first.

1. Collect the monthly repayment they can manage, their deposit, the interest rate and the term. Ask once for any that are missing; never assume a rate. If they want to rent, say this works out a buying budget and offer to search homes to rent at their monthly rent instead.
2. Find the highest price that fits with `calculate_mortgage`: pass a price, their deposit, rate and term, read the monthly payment it returns, and adjust the price until the repayment is just at or under their budget. Round down to the nearest thousand. Usually three or four tries are enough.
3. Run `calculate_stamp_duty` at that price with `buyer_type`: `first_time`, `additional` or `standard`; ask which applies if they have not said. If they say stamp duty must come out of the same savings as the deposit, lower the price until the deposit left after stamp duty still meets the loan, and say so. Stamp duty here covers England and Northern Ireland.
4. Run `search_homes` with `listing_type` `sale`, `max_price` set to that price, and the place, bedrooms and any `wishes` they gave. Show the results with `render_home_listings`.
5. Put the sum first in one short table: monthly budget, loan, deposit, highest price, stamp duty and total interest, each labelled as an estimate to confirm with a mortgage broker. Then the homes, and for any wish say only what each listing states.

Never say whether they can borrow that much, recommend a lender or a product, or present the figure as a mortgage offer. Never estimate what a home is worth.
