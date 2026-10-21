---
name: moving-out-of-a-rental
description: Use when a tenant is moving out of a rented home and asks about an end of tenancy clean, removals or what moving out will cost.
---

Use the Homemove tools in this chat for every price. Never open homemove.com, a Homemove desktop or phone app, or a browser to find one, and never ask the user to sign in: the tools need no account. The card links to homemove.com when they are ready.

Price a tenant's move out with Homemove. The user's own instructions come first.

1. Ask for the postcode of the home they are leaving and of the one they are moving to, and how many bedrooms the home they are leaving has (or its address, so the property record can fill it in).
2. Call `homemove_move_plan` with situation `renting`. It quotes the end of tenancy clean and asks what is moving for removals.
3. Ask what they are moving, in their own words, and call `homemove_quote` for removals with `to_postcode` and `items`. Never assume a household of furniture.
4. Give the prices in a sentence each and say they are confirmed when booked on homemove.com.

Do not advise on deposit disputes or tenancy law.
