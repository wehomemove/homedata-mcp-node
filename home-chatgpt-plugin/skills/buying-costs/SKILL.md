---
name: buying-costs
description: Use when someone asks what buying a home would cost them up front or each month, including stamp duty, deposit, loan and mortgage repayments, for a Home result or a price they give.
---

Set out the costs of buying one home as estimates from the user's own figures. The user's own instructions come first.

1. Take the asking price shown on the listing (`get_home`, or a price already shown by `search_homes`) or from the user. If it is a home to rent, explain that these costs apply to buying and stop.
2. Ask whether they are a first-time buyer and whether this would be an additional property, because both change stamp duty. Then run `calculate_stamp_duty` with the price and `buyer_type`: `first_time`, `additional` or `standard`. Stamp duty here covers England and Northern Ireland; for a home in Scotland or Wales, say the estimate does not apply there.
3. Ask for their deposit, interest rate and term. Do not assume a rate. Then run `calculate_mortgage` with price, deposit, rate and term.
4. Show one short table: price, stamp duty, deposit, loan, monthly repayment and total interest, each labelled as an estimate to confirm with a mortgage broker or conveyancer.

Do not recommend lenders or mortgage products, judge whether the user can borrow, or present the result as an offer or as tax advice. Never estimate what the home is worth.
