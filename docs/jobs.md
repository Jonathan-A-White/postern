# Jobs: the feed for by-hand work

A job is work the Governor does by hand over a list of things, and wants to see the progress of: his
Subsplash mails and links, one per sermon, is the first. Postern's **Jobs** page shows each job; the
**factory keeps the feed current** (an hourly sweep, or whatever owns the job). Postern only reads it.
The feed is reusable by any rig: write a file in the shape below and the job appears.

<!-- toc -->

- [Where the feed lives](#where-the-feed-lives)
- [The file](#the-file)
- [Rules (what is skipped)](#rules-what-is-skipped)
- [The routes](#the-routes)
- [What the page shows](#what-the-page-shows)
- [Writing a feed](#writing-a-feed)

<!-- /toc -->

## Where the feed lives

One JSON file per job, `jobs/<job-id>.json`, under the backend's state directory (`POSTERN_DATA`, the
directory the backend already keeps its stores in). `<job-id>` is 1 to 63 characters of `a-z`, `0-9` and `-`,
starting with a letter or digit. The factory makes the `jobs/` directory; with none there are no jobs.
Nothing else in Postern reads or writes those files: the app asks the backend, never the disk.

## The file

```json
{
  "id": "subsplash-links",
  "title": "Subsplash links",
  "updated": "2026-11-11T18:00:00Z",
  "checks": ["mail", "link", "live"],
  "items": [
    {"label": "Romans 8", "date": "2026-11-09", "link": "https://example.org/romans-8",
     "done": {"mail": true, "link": true, "live": true}},
    {"label": "Romans 7", "date": "2026-11-02", "done": {"mail": true, "link": false}}
  ],
  "here": 1,
  "note": "Romans 7 waits on its link"
}
```

| Field | Meaning |
|---|---|
| `id` | the job's id; must equal the file's name without `.json` |
| `title` | what the Jobs page calls it |
| `updated` | when the factory last refreshed the feed (RFC 3339); the page says "updated 5 min ago" |
| `checks` | the names of the checks every item is held to, in the order they are drawn (one tick or dot each) |
| `items` | the things the job is over, **in the order to show them (newest first)**; the page does not sort |
| `items[].label` | the item's name (required) |
| `items[].date` | optional; shown beside the label as written |
| `items[].link` | optional `http(s)` URL the label opens |
| `items[].done` | `{check: bool}`; a check left out has not passed |
| `here` | optional index into `items` of the "you are here" row: where the Governor's hand work has got to |
| `note` | optional one line shown at the top of the job's page |

An item is **done** when every check in `checks` is `true` for it. A job is **done** when it has at least one item
and every item is done. A job with no checks is never done.

## Rules (what is skipped)

A file that is not valid JSON, whose `id` is not its file name, with no `title`, an `updated` that is not an
RFC 3339 time, an empty or repeated check name, an item with no label, a `done` key that is not in `checks`, a
`link` that is not `http` or `https`, or a `here` outside `items` is **skipped with one log line**
(`jobs: skipping <file>: <why>`) and left out of the list; `GET /api/jobs/{id}` answers 404 for it. A bad file is
never a 500 and never hides the good ones. A file over 4 MiB is bad. A missing `jobs/` directory is no jobs
and no log line. Files are read on each request, so a rewrite shows at once; write to a temporary name and
rename, so a read never sees half a file.

## The routes

Both need the usual signed proof and a cockpit key (`403` for an app key or the mill's); without the store they
answer `501`. Both are answered with `Cache-Control: no-store`.

- `GET /api/jobs` — `200 {"jobs": [{"id", "title", "updated", "done", "total"}]}`, newest `updated` first.
  `done` is the number of done items, `total` the number of items.
- `GET /api/jobs/{id}` — `200` the whole file as above (`checks`, `items` and each `done` map always present,
  never `null`), or `404 {"error": "no such job"}` for an unknown id or a bad file.

## What the page shows

- **Home** (Needs you) shows a **Jobs** chip while any job exists, with the count of open jobs.
- **Jobs** lists open jobs (title, "N of M done", updated), then a **Done** fold with the finished ones.
- A job's page lists its items in the feed's order, a tick or a dot per check, the `here` row marked and scrolled
  to, the `note`, and "Updated <time ago>". A job whose items are all done shows "Done".

## Writing a feed

Write the whole file each refresh (set `updated` to now, even if nothing changed: it is how the Governor knows
the sweep is alive), via a temporary file and a rename. Keep `items` newest first and point `here` at the item
his hands are on. Add a check by adding a name to `checks`; an item that has not met it yet simply leaves it out.
