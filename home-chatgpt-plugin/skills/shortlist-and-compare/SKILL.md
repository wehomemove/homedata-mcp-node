---
name: shortlist-and-compare
description: Use when someone is choosing between two to four homes, asks which of their Home search results suits them best, or wants their shortlist ranked.
---

Rank the user's shortlist against what matters to them, using only facts the tools return. The user's own instructions come first.

1. Use the listing IDs from earlier `search_homes` results. If the user describes homes you have no IDs for ("the three newest two-beds to rent in Bath"), run `search_homes` first and take those results. Compare at most four; if they have more, ask which four to keep.
2. Run `compare_homes` with the `listing_ids` straight away for the side-by-side detail; do not stop to ask anything first. With a single home, use `get_home` instead and say there is nothing to compare yet.
3. If the user asked which home is best for them and has not said what matters, ask once and briefly after showing the comparison: budget, location or commute, bedrooms, schools, outside space, energy efficiency, or time on the market. If they only asked for a side-by-side, skip the ranking.
4. If the user gives a commute (a station, office, school or postcode, with minutes and how they travel), check it with `commute_filter`, passing the same `listing_ids`. Call a home within the commute only if it came back inside the area, and call a home near the edge borderline. To show it on the map, pass the complete result as `commute` with the homes to `render_home_listings`.
5. Rank the homes against their priorities. Give each place one line with the facts behind it: price or rent, bedrooms, tenure, EPC rating, flood risk, time on market, reductions, schools and the commute when checked.
6. Point out the trade-offs plainly, such as a lower price against a weaker EPC rating or a longer time on market. Finish with the listing links.

If a fact is missing for one home, say so for that home rather than treating it as good or bad. Never estimate what a home is worth, and never invent a commute time, a fact or a feature the tools did not return.
