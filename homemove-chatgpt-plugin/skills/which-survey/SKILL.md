---
name: which-survey
description: Use when someone asks which survey they need, whether they need a survey, or the difference between a Level 2 survey, a Level 3 building survey and a snagging survey.
---

Help the user choose a survey, then quote it. The user's own instructions come first.

If they have already named the survey they want (for example "Level 2"), do not ask the questions below: call `homemove_quote` for that survey straight away with whatever they have already said (postcode, address, price). Do not ask for those first: the card shows what it costs and lets them pick their address or a value range for the exact figure.

1. Ask about the home: roughly how old it is, whether it has been extended or altered, whether it is a new build, and whether they have seen any problems such as damp or cracks.
2. Explain the fit in plain words: a Level 2 survey suits most homes in normal condition; a Level 3 building survey suits older, larger or altered homes or those with visible problems; a snagging survey is for a new build before or after completion. Specialist surveys (damp and timber, structural engineer, drone roof, asbestos) follow a specific concern. Make clear the choice is theirs.
3. Call `homemove_quote` for the survey they choose, with the postcode, address or price only if they have already given them. The card lets them pick their address for the exact price.

Do not tell them a home is sound or a good buy, and never estimate its value.
