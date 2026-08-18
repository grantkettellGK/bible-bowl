# Bible Bowl Daily Quiz

A self-contained web app for Bible Bowl teams:

- **Students** create their own accounts, take **one graded daily quiz** (10 randomized
  questions from their assigned scripture), and get **unlimited practice mode** with
  instant feedback (practice never affects tracked scores).
- **The coach (admin)** gets a dashboard of every student's daily scores, averages,
  and streaks; uploads scripture books as JSON; and assigns books per student.

Zero npm dependencies — plain Node.js (>= 22.5) with the built-in `node:sqlite`.
All data lives in one SQLite file under `data/`.

## Run it

```bash
node server.js
```

Open http://localhost:3000.

**The first account created becomes the admin (coach).** Create yours first, then
share the link with students — every account created after the first is a student.
Admins land on `/admin`; students land on the quiz dashboard.

### Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | Where the SQLite database lives |
| `QUIZ_TZ` | `America/New_York` | Timezone that defines when "today" rolls over |
| `DAILY_COUNT` | `10` | Questions per daily quiz |
| `COOKIE_SECURE` | unset | Set to `1` when serving over HTTPS |

## Scripture JSON format

Upload from **Coach Dashboard → Scripture Books**. Primary format:

```json
{
  "book": "Acts",
  "translation": "NKJV",
  "chapters": [
    {
      "chapter": 1,
      "verses": [
        { "verse": 1, "text": "The former account I made, O Theophilus, ..." },
        { "verse": 2, "text": "..." }
      ]
    }
  ]
}
```

Also accepted:

- `verses` as a plain array of strings (verse numbers inferred from position)
- `chapters` as an object map: `{ "1": { "1": "text", "2": "text" } }`
- A top-level **array** of several book objects in one file

Re-uploading a book with the same `book` + `translation` replaces its text.
See `sample-scripture.json` for a working example (Psalm 23 + 100, KJV).

> Note on translations: KJV is public domain. Most modern translations (NIV, NKJV,
> ESV...) are copyrighted — for use in a private team study app, check the
> publisher's license terms.

## How questions are generated

Four auto-generated multiple-choice types, mixed per quiz:

1. **Fill in the blank** — a significant word is blanked; distractors drawn from the book's own vocabulary
2. **Where is this verse found?** — pick the correct reference
3. **Quote the verse** — given a reference, pick the correct text
4. **What comes next?** — pick the verse that follows

The daily quiz is generated once per student per day (stored server-side, graded
server-side, answers never sent to the browser until after submission). One graded
attempt per day is enforced by a database constraint.

## Deployment

See [DEPLOY.md](DEPLOY.md) for step-by-step DigitalOcean instructions.
