---
name: plan-a-viewing-day
description: Use when someone has two to six homes in mind, from a Home search or shortlist, and wants to see them in one day, or asks for the best order to view them and how much driving it is.
---

Put the user's viewings in the quickest driving order and help them use each stop. The user's own instructions come first.

1. Use the listing IDs from earlier `search_homes` results. If the user describes the homes ("the four newest three-beds in Bath"), run `search_homes` first and take those results. Plan two to six homes; if they have more, ask which six to keep.
2. If they have said where the day starts (home, a station, an office or a postcode), pass it as `start` with its town, and `start_kind` when it is a `station`, `school`, `office`, `postcode` or `address`. If they have not said, plan without a start rather than inventing one, and mention that a start point can change the order.
3. Call `plan_viewings` with the `listing_ids`. Present the stops in its order, one line each: the address exactly as it came back, the drive from the previous stop in minutes, and the running total. End with the total driving time. Then pass its complete result as `route`, with the same homes from the search, to `render_home_listings` so the map shows the route.
4. Say plainly that the times leave out traffic, parking and the viewings themselves, so they should leave time between slots and confirm each one with its agent. Never promise an arrival time.
5. If they asked what to look at, add two or three questions for each stop from that home's own facts with `get_home`, as in prepare-for-a-viewing. If they mention a commute, check it with `commute_filter` and flag any home outside it.

Never add a house number or any detail the tools did not return, and never estimate what a home is worth.
