# Trip Budget

A daily spending ledger for a single trip. You set a strict budget; it works out
what each day can take and tells you when to pull back or when there is room for
a good dinner.

No build step, no dependencies, no backend. Plain HTML, CSS and JavaScript.
Type is Fraunces for figures and Inter for labels. It opens in the light theme for
everyone; the sun/moon button switches to dark and the choice sticks.

## How the numbers work

```
spendable      = total budget − prepaid items − emergency buffer
plan per day   = spendable ÷ number of days
today's ceiling = (spendable − spent before today) ÷ days remaining (today included)
```

The ceiling is the number that matters. It is recomputed from what is actually
left, so every overspend lowers the days that follow and every quiet day raises
them. Spend exactly the ceiling each day and you finish on the last day with
zero left, by construction.

Two other figures sit beside it:

- **your average** — total spent ÷ days elapsed, the figure that drifts up and down
- **pace** — where the flat plan says you should be, minus where you actually are

Prepaid items (flights, hotels booked in advance) are taken off the top, so they
never distort the daily average. The buffer is held back before the daily figure
is worked out, so a bad day does not eat the trip.

## Currencies

The trip has one **home currency** (INR by default), chosen when you set it up.
The budget and every total are in it. It locks once spends are logged, because
those spends have been converted into it.

Each spend can be in any currency. Pick it next to the amount; the app
converts at the day's rate and stores four things: the amount in home currency,
the amount actually paid, its currency, and the rate used. Past spends never
move when rates change, and editing one keeps its original rate unless you
change it.

Rates come from ExchangeRate-API's open endpoint (no key, updated daily,
attribution shown in the add sheet as their terms require) and are cached on
the device for 12 hours. If there is no connection the app reuses your last
rate for that currency, and if it has never seen one it asks you to type it,
phrased the way people say it ("$1 buys how many THB?").

While you are spending in a foreign currency, the Today screen also shows what
is left in that currency.

Trips saved before currencies existed are read as INR with every figure
unchanged, and older versions of the app can still read new data.

## Screens

| Screen | What it answers |
| --- | --- |
| Today | What can I spend today, and how is the trip going overall |
| Totals | Where has the money gone, by category and against the budget |
| Days | What exactly did I buy, day by day |
| Trip | Budget, dates, split, backup |

The copy is deliberately thin. If a line only explains what the numbers already
show, it was cut.

## Data

Everything is stored in `localStorage` on the device, under the key
`tripbudget.v1`. Nothing is sent anywhere — there is no server to send it to.
**Trip → Download backup** writes a JSON file you keep yourself; **Restore**
reads one back. Take a backup every few days on a trip.

If the same files are served inside a Claude artifact, the app also mirrors the
data to the signed-in account automatically. That path is feature-detected at
runtime and is inert on your own domain.

## Analytics

`index.html` carries the plain-HTML Vercel Web Analytics snippet. It does
nothing until you switch Analytics on for the project in the Vercel dashboard
(Project → Analytics → Enable); that deployment starts serving the
`/_vercel/insights/*` routes the script talks to. Before that, and on localhost,
the script 404s and nothing breaks.

It is cookieless and reports page views and referrers in aggregate, so there is
no consent banner to add. The service worker deliberately ignores `/_vercel/`,
and `build-artifact.mjs` strips the snippet from the Claude build, where the
path does not exist.

Speed Insights, if you want it too, is two more tags in the same place:

```html
<script>window.si = window.si || function () { (window.siq = window.siq || []).push(arguments); };</script>
<script defer src="/_vercel/speed-insights/script.js"></script>
```

## Google Analytics

The GA4 tag (`G-G3LPX71J7E`) is in `index.html`; the events are sent by
`track()` in `app.js`. Nothing personal leaves the device: no amounts, notes,
trip names or budgets.

| Event | When | Parameters |
| --- | --- | --- |
| `app_open` | every launch | `has_trip`, `installed`, `theme` |
| `time_spent` | each time the app is put away | `seconds`, `view` |
| `trip_created` / `trip_updated` | saving the trip form | `trip_days`, `prepaid_items`, `buffer_pct` |
| `spend_logged` / `spend_edited` | saving a spend | `category`, `backdated`, `has_note` |
| `spend_deleted` | deleting a spend | |
| `tab_view` | switching section | `tab` |
| `theme_changed` | sun/moon button | `theme` |
| `backup_downloaded` / `backup_copied` / `backup_restored` | backup actions | |
| `trip_reset` | deleting the trip | |

To see a parameter in GA reports, register it under Admin → Custom definitions.
Unlike Vercel Analytics, GA sets cookies; if people in the EU or UK will use
this, it needs a consent prompt before the tag loads.

## Keeping it unlisted

`index.html` carries `<meta name="robots" content="noindex, nofollow">` so the
page stays out of search results while this is just for you and a few testers.
Delete that line when you want it indexed.

## Offline

`sw.js` caches the app shell on first load and the web fonts the first time they
are fetched, so the app opens on a plane or in a dead zone. It needs HTTPS (or
localhost); Vercel gives you that.

## Run it locally

```sh
python3 -m http.server 8080
# then open http://localhost:8080
```

Any static server works. Opening `index.html` straight off the filesystem mostly
works too, but the service worker will not register from `file://`.

## Deploy to Vercel

1. Push this folder to a GitHub repository.
2. In Vercel, **Add New → Project**, import the repository.
3. Framework preset: **Other**. Leave the build command empty and set the output
   directory to the repository root (`.`). There is nothing to build.
4. Deploy.

`vercel.json` stops the service worker and the manifest from being cached hard,
so a new deploy reaches phones that already have the app installed.

To install it on a phone: open the deployed URL, then **Share → Add to Home
Screen** (iOS) or **⋮ → Install app** (Android).

## Files

```
index.html            markup and font links
app.css               all styling, including both colour schemes
app.js                model, arithmetic, views, events
sw.js                 offline cache
manifest.webmanifest  name, colours, icons for installing
icons/                app icons (SVG plus PNG for iOS and Android)
vercel.json           cache headers
```

## Licence

Yours. Do what you like with it.
