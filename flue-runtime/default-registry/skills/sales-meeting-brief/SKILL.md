---
name: sales-meeting-brief
description: Turn today's calendar into one brief per sales meeting, covering the account history, the competitive picture, and what to pitch
---

# Sales meeting brief

Run once for the day. Read today's calendar, keep the meetings that are external
sales conversations, and write one brief per meeting.

Skip anything internal, recurring standups, personal blocks, and any meeting whose
attendees are all on your own domain. Say in the brief how many meetings you skipped
and why, so a missing brief is never mistaken for a missing meeting.

For each remaining meeting, gather in this order and stop as soon as a source is
unavailable rather than guessing:

1. **What was already discussed.** Search mail for threads with the attendees and the
   account. Pull the commitments, objections, pricing said out loud, and open questions.
   Quote the sentence that carries each one; a paraphrase of a price is a new price.
2. **The account.** What they sell, their size, their recent public news. Prefer their
   own site and filings over commentary about them.
3. **The competitive picture.** Which competing product they use or evaluated, and the
   two or three places we differ that matter for the account's own stated problem.
4. **The people.** For each external attendee, read their recent public posts on X and
   LinkedIn. You are looking for what they are measured on, what they say is hard, and
   the words they use for it — not biography.

Then write `outputs/brief-<account>-<HHMM>.md` with these sections, in this order:

- **Meeting** — time, attendees, and their roles.
- **Where we left off** — dated, quoted, and attributed. Say plainly when there is no
  prior thread; a first conversation is a different meeting from a fifth.
- **The account** — three lines at most.
- **Against the competition** — the specific alternative, and where we win for them.
- **Pitch angles** — two or three, each tied to a quoted post or a line from the thread,
  each phrased as the opening sentence you would actually say.
- **Ask** — the single outcome to leave with.
- **Sources** — every link used, and every source that was unreachable.

Rules that matter more than completeness:

- A claim without a source does not go in. Write "not found" and move on.
- Never state a price, a discount, or a delivery date that is not quoted from a thread.
- Public posts only. Do not infer anything about a person from what you cannot cite.
- If the calendar is empty or unreadable, write one line saying so and stop. An empty
  brief is a correct answer; an invented one costs the meeting.
