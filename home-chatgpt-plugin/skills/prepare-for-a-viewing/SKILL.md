---
name: prepare-for-a-viewing
description: Use when someone has a home in mind, from a Home search or a home.co.uk link, and is going to view it or wants to know what to check and ask before making an offer.
---

Build a viewing checklist from this home's own details, never a generic one. The user's own instructions come first: if they ask for something shorter or different, do that.

1. Find the home. If you have its listing ID from an earlier `search_homes` result, use it. If the user describes it ("the newest three-bed in Bath"), run `search_homes` and take the matching result. If more than one result fits, ask which one they mean.
2. Get it in full with `get_home` and its `listing_id`.
3. Read the enrichment's scope. Scope home means the checks are about this home. Scope area means they are postcode-level facts: present them as facts about the area, never about the home. If the checks are unavailable, say so plainly and, when the listing has a postcode, run `area_insights` for it so the area points still rest on evidence.
4. Write the checklist from what came back, one line each, and only for points the data supports:
   - Energy: the EPC rating and date. At D or below, ask about heating, insulation and running costs.
   - Flood and radon: if any risk is above low, ask about insurance, past flooding and a survey.
   - Age band: before 1919, ask about damp, the roof and rewiring; 1930 to 1970, ask about windows and asbestos.
   - Tenure: for leasehold, ask about years remaining, ground rent and service charge.
   - Time on market and reductions: if it has been listed a long time or reduced, ask why, and note it as context for an offer. If it is under offer, say so first.
   - Broadband: if full fibre is not available and the user works from home, flag it.
   - Schools and recorded crime: summarise only if the user mentioned family, schools or safety. Report the evidence; never call an area safe or unsafe.
5. End with the five questions most useful to ask the agent, then the listing link.

Never estimate what the home is worth or what to offer, and never fill a gap with a guess: if a fact did not come back, say it was not available.
