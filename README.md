# Homedata MCP server (Node)

UK property data as tools for AI assistants. Ask Claude, Cursor, Codex or any
[Model Context Protocol](https://modelcontextprotocol.io) client about an
address and it can look up the property record, EPC, council tax, flood and
other environmental risks, planning, schools, broadband, crime, local
amenities and area price trends through the [Homedata API](https://homedata.co.uk).

The tools are exactly the self-serve endpoints of the
[Homedata Developer Playground](https://homedata.co.uk/try): the same names,
the same arguments and the same prices.

## Install

Requires Node 18 or newer.

```bash
npm install -g homedata-mcp
```

or run it without installing:

```bash
npx -y homedata-mcp
```

There is an equivalent [Python package](https://pypi.org/project/homedata-mcp/) with the same tools, generated from the same list.

## Get an API key

Create an account at [homedata.co.uk/register](https://homedata.co.uk/register),
verify your email, and copy your key from the developer dashboard. Calls are
paid for in tokens from a prepaid balance; see
[homedata.co.uk/pricing](https://homedata.co.uk/pricing). Every tool's
description states what it costs, and every call reports what it actually
cost (see [What a call costs](#what-a-call-costs)).

Without a key the server still starts, with two helpers,
`start_homedata_signup` and `check_homedata_api_key`, so your assistant can
walk you through getting one. Neither helper calls the API.

## Connect it to your assistant

Most clients take the same command, arguments and environment. For Claude
Desktop, add this to `claude_desktop_config.json` and restart the app:

```json
{
  "mcpServers": {
    "homedata": {
      "command": "npx",
      "args": ["-y", "homedata-mcp"],
      "env": { "HOMEDATA_API_KEY": "your_key" }
    }
  }
}
```

With `npm install -g homedata-mcp`, use `"command": "homedata-mcp"` and no `args`.

Claude Code:

```bash
claude mcp add homedata --env HOMEDATA_API_KEY=your_key -- npx -y homedata-mcp
```

Step-by-step guides for Claude Desktop, Claude Code, Cursor, Codex CLI,
Windsurf, Cline, Continue.dev and Zed are at
[homedata.co.uk/mcp](https://homedata.co.uk/mcp).

## Using the tools

Start with `address_find` to turn an address into a UPRN, then use the
property tools with that UPRN. For a whole property, one tier call is cheaper
than many small ones: `property_base`, then `property_core` (the usual full
picture), then `property_complete`. `property_discovery` costs 1 token and
shows what a property has before you commit to a tier.

<!-- BEGIN GENERATED: tools -->
| Tool | Tokens | What it returns |
|---|---|---|
| `address_find` | 2 | Find UK addresses from free text: an address, a postcode or a place name. Returns matching addresses with their UPRN, which every property tool takes. |
| `address_postcode` | 2 | List every registered address at a UK postcode, with the UPRN for each one. |
| `amenities_all` | 5 | Every amenity group near a property in one response: food, education, healthcare, financial, civic, worship, culture, convenience, green spaces, transport and shops. |
| `amenities_civic` | 1 | Civic places near a property: post offices, town halls, courthouses, fire and police stations, community centres. |
| `amenities_convenience` | 1 | Everyday conveniences near a property: public toilets, charging points, parcel lockers and similar. |
| `amenities_culture` | 1 | Culture and leisure near a property: theatres, cinemas, music venues, museums, galleries and attractions. |
| `amenities_education` | 1 | Education near a property: schools, nurseries, colleges, universities, childcare and libraries. For Ofsted ratings and pupil numbers use schools. |
| `amenities_financial` | 1 | Banks, cash machines and money services near a property. |
| `amenities_food` | 1 | Places to eat and drink near a property: cafes, restaurants, pubs, bars, takeaways. |
| `amenities_green_spaces` | 1 | Green space near a property: parks, playgrounds, gardens, nature reserves, commons and sports pitches. |
| `amenities_healthcare` | 1 | Health services near a property as mapped locally: doctors, dentists, clinics, hospitals, pharmacies and care homes. For regulator-registered records use healthcare_all and its per-type tools. |
| `amenities_shops` | 1 | Shops near a property, from supermarkets to specialist retailers. |
| `amenities_transport` | 1 | Transport stops near a property: bus stops, railway stations, tram stops and ferry terminals. |
| `amenities_worship` | 1 | Places of worship near a property. |
| `attr_construction` | 1 | How a property was built: construction age band, main construction material, and whether it has a basement. |
| `attr_dimensions` | 1 | Measurements for a property: footprint area in square metres, building height, estimated volume and predicted floor area. |
| `attr_epc` | 1 | Energy Performance Certificate headline for a property: current and potential efficiency rating, EPC floor area and the date of the last assessment. |
| `attr_epc_renovations` | 1 | Improvements recommended by a property's EPC assessment, each with estimated minimum and maximum cost. |
| `attr_garden` | 1 | Whether a property has a garden, and of what kind. |
| `attr_land` | 1 | Plot size in square metres for a property. Houses only: flats and maisonettes have no plot, and those return an error with nothing charged. |
| `attr_parking` | 1 | Whether a property has parking, and of what kind: driveway, off-street, garage and so on. |
| `attr_roof` | 1 | A property's roof: material, shape, and whether solar panels are fitted. |
| `attr_rooms` | 1 | Room counts for a property: bedrooms, bathrooms, habitable rooms and heated rooms. |
| `boundaries` | 1 | Search UK administrative areas by name and get their boundary id, for tools that take one. |
| `broadband` | 1 | Broadband availability at a postcode: average and maximum download and upload speeds, superfast, ultrafast, gigabit and full-fibre coverage, and how many premises are covered. From Ofcom Connected Nations. |
| `calc_mortgage` | free | Work out a mortgage from price, deposit, rate and term: monthly payment, total repayment, total interest, and loan-to-value and loan-to-income ratios. |
| `calc_stamp_duty` | free | Work out Stamp Duty Land Tax for England and Northern Ireland: total tax, effective rate and a band-by-band breakdown, for a main residence, a first-time buyer or an additional property. |
| `council_tax` | 3 | Council tax band for a property, with the billing authority name and its official code. For the yearly and monthly charge in pounds, use council_tax_full instead. |
| `council_tax_full` | 5 | The full council tax record for a property: band, billing authority and its official code, this year's yearly and monthly charge in pounds, the 1991 valuation bounds behind the band, and the fiscal year. |
| `crime` | 1 | Recorded crime near a postcode or coordinates, by category and month, from Police UK. |
| `demographics` | 1 | Census 2021 profile for the area around a postcode: population, tenure, age bands, ethnicity, occupation, household size and car ownership, plus deprivation where available. |
| `deprivation` | 1 | Index of Multiple Deprivation scores for a postcode, across income, employment, education, health, crime, housing and environment. England only. |
| `fuel_stations_all` | 1 | Petrol stations and EV charging points near a property, each tagged with which it is. |
| `fuel_stations_ev` | 1 | EV charging points near a property. |
| `fuel_stations_petrol` | 1 | Petrol stations near a property. |
| `healthcare_all` | 3 | Health services near a property: regulator-registered GPs, dentists and hospitals, plus pharmacies. Registered entries carry name, address, postcode, region, distance and a link to the official register record. Registered records cover England. |
| `healthcare_dentists` | 1 | Registered dental practices near a property, with name, address, postcode, region, distance and a link to the official register record. England only. |
| `healthcare_gps` | 1 | Registered GP practices near a property, with name, address, postcode, region, distance and a link to the official register record. England only. |
| `healthcare_hospitals` | 1 | Registered hospitals near a property, with name, address, postcode, region, distance and a link to the official register record. England only. |
| `healthcare_pharmacies` | 1 | Pharmacies near a property, with name, address, phone and website where known. |
| `listed_buildings` | 3 | Listed buildings within a radius of a postcode: Grade I, II* and II entries with name, location, listing date and a link to the official record. |
| `planning` | 5 | Planning applications near a postcode or coordinates: type, status, description and decision date, with filters for recency, type and status. |
| `postcode_profile` | 1 | One-call summary of a postcode: deprivation, crime, average property price, nearby schools, transport and broadband. Cheaper than calling those tools separately. The first call for a postcode is slow, because the parts are gathered and combined when you ask for them; the result is then cached, so asking again for the same postcode is fast. Wait for the first call rather than retrying it — retrying abandons the work already in progress and starts it over. |
| `price_distributions` | 1 | How property prices are spread across an outcode area: percentiles, median and transaction counts by property type. |
| `price_growth` | 1 | Capital growth for an outcode area: annual growth rate, returns over one, three, five and ten years, and a historical price index, from Land Registry sold prices. |
| `price_trends` | 1 | Average property prices over time for an outcode area. |
| `property_address` | 5 | Address-only record for a property: full address, postcode, coordinates and the standard address identifiers. The cheapest property tier, for address verification, form pre-fill and matching. |
| `property_base` | 10 | The house-hunter view of a property: address, rooms, EPC rating, last sale, construction, dimensions, garden, parking and title basics, in one call. |
| `property_complete` | 50 | Everything held on a property in one call: the Core record plus the full council tax charge, full title, environmental risks, deprivation, planning history and area price trends. |
| `property_core` | 25 | The full listing view of a property: everything in Base plus council tax band, flood risk, schools, broadband, crime, demographics, solar potential, confirmed sales and planning constraints. The usual starting point. |
| `property_custom` | 1 + add-ons | Build your own property record: the base record plus only the add-ons you ask for, so you pay for exactly what you use. Call property_discovery first to see which add-ons a property has. |
| `property_discovery` | 1 | The cheap first call for a property: which data is available for it, what each add-on costs, and the shortcuts to each tier. Also the quickest way to check whether a UPRN is one we hold. |
| `property_lr_titles` | 10 | Land Registry title records for a property: tenure, title number and registered owner where held. |
| `risks` | 1; 5 when `risk_type` is all | Environmental risk screening for a property: flood, radon, noise, landfill, coal and other mining, invasive plants and air quality. Ask for one hazard, or for all of them in a single response. |
| `schools` | 1 | Schools near a postcode, with Ofsted rating, phase, pupil numbers and distance, from the Department for Education register. England only. |
| `solar` | 5 | Solar potential for a property: usable roof area, estimated yearly generation, savings, payback period and carbon saved. |
| `start_homedata_signup` | none | Get a Homedata API key so the property data tools can be used: returns the sign-up link and the steps to follow. Makes no API call. |
| `check_homedata_api_key` | none | Check whether this server has a Homedata API key configured and what to do next if it has not. Makes no API call, so it never spends anything. |
<!-- END GENERATED: tools -->

## What a call costs

Each tool's description states its price in tokens. When the API reports what
a call actually cost, the tool result carries it in its metadata:

```json
{ "homedata": { "tokens_charged": "25", "tokens_balance": "9975" } }
```

Arguments are checked before anything is sent: a call with a missing,
malformed or unknown argument is refused by the server and never reaches the
API.

## Command line

The package also installs `homedata`, built from the same tool list:

```bash
homedata tools                                   # every tool and its price
homedata address_find --q "10 Downing Street"
homedata property_core --uprn 100023336956 --field epc
homedata calc_mortgage --price 300000 --deposit 30000 --rate 4.5 --term-years 25
homedata risks --help                            # the arguments for one tool
```

`--field <dotted.path>` prints one value, `--compact` prints one line of JSON,
and the tokens a call cost are printed to stderr. The calculators are free and
need no key.

## Configuration

| Variable | Required | Default |
|---|---|---|
| `HOMEDATA_API_KEY` | for everything except the calculators and the signup helpers | none |
| `HOMEDATA_BASE_URL` | no | `https://api.homedata.co.uk` |

## How the tool list is kept right

`src/manifest/` is a vendored copy of the tool list from the
[Python package](https://github.com/wehomemove/homedata-mcp), which generates it
from the Developer Playground catalogue. `src/manifest/SOURCE.json` records the
exact commit and a hash per file, and CI fails if a vendored byte differs from
that commit. Every tool here is built from that copy, and the same guard that
checks the Python server checks this one, so the two cannot describe the API
differently. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

```bash
git clone https://github.com/wehomemove/homedata-mcp-node.git
cd homedata-mcp-node
npm ci
npm run build
npm test
```

## Licence

MIT. See [LICENSE](LICENSE).
