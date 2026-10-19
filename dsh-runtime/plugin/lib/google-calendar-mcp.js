import { randomUUID } from "node:crypto";
import { z } from "zod";
import { googleServer } from "./google-mcp.js";

const { google, tool, serve } = googleServer("Google Calendar", "https://www.googleapis.com/calendar/v3/");

const list = (value) => value.split(",").map((item) => item.trim()).filter(Boolean);
const events = (calendarId) => `calendars/${encodeURIComponent(calendarId)}/events`;
const at = (calendarId, eventId) => `${events(calendarId)}/${encodeURIComponent(eventId)}`;
const changes = { sendUpdates: "all", conferenceDataVersion: 1 };

// a time without an offset is this computer's clock, which is the owner's
function instant(value) {
  const date = new Date(value.includes("T") ? value : `${value}T00:00`);
  // Date quietly rolls 2026-09-31 over to October
  const day = value.slice(0, 10);
  if (Number.isNaN(date.getTime()) || !String(new Date(`${day}T00:00Z`).toJSON()).startsWith(day))
    throw new Error(`${value} is not a date or a date and time`);
  return date.toISOString();
}

// no zone name: the instant is exact, and the event keeps the calendar's own zone
const when = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? { date: value } : { dateTime: instant(value) };

const brief = ({ id, summary, start, end, location, description, attendees, organizer, hangoutLink, conferenceData, status }, budget = 4_000) => ({
  id, summary, start: start?.dateTime ?? start?.date, end: end?.dateTime ?? end?.date, status, location, organizer: organizer?.email,
  meet: hangoutLink ?? conferenceData?.createRequest?.status?.statusCode, description: description?.slice(0, budget),
  guests: attendees?.map(({ email, responseStatus }) => `${email} ${responseStatus}`)
});

/** Only the fields given, so an update keeps the rest. A guest already invited keeps their answer. */
function body({ summary, description, location, start, end, attendees, meet }, current) {
  const given = {
    summary, description, location,
    start: start ? when(start) : undefined,
    end: end ? when(end) : undefined,
    attendees: attendees === undefined ? undefined : list(attendees).map((email) =>
      current?.attendees?.find((guest) => guest.email?.toLowerCase() === email.toLowerCase()) ?? { email }),
    conferenceData: meet && !current?.conferenceData
      ? { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } }
      : undefined
  };
  return Object.fromEntries(Object.entries(given).filter(([, value]) => value !== undefined));
}

const calendarId = z.string().default("primary").describe("An id from list_calendars. primary is the owner's own calendar");
const fields = {
  summary: z.string(),
  start: z.string().describe("2026-09-18T10:00 is this computer's time zone unless it ends in an offset like +05:45. 2026-09-18 alone makes an all day event"),
  end: z.string().describe("Same form as start. An all day event ends on the day after its last day"),
  description: z.string().optional(),
  location: z.string().optional(),
  attendees: z.string().optional().describe("Guest emails, comma separated"),
  meet: z.boolean().optional().describe("Add a Google Meet link")
};

tool("list_calendars", "List the calendars in this Google account with their ids.", {},
  async () => (await google("users/me/calendarList")).items
    .map(({ id, summary, primary, accessRole, timeZone }) => ({ id, summary, primary, accessRole, timeZone })));

tool("search_events", "Find events in a time window, soonest first, optionally matching words in their title, description, place or guests.",
  {
    calendarId,
    from: z.string().optional().describe("Same form as an event start. Defaults to now"),
    to: z.string().optional(),
    query: z.string().optional(),
    maxResults: z.number().int().min(1).max(50).default(20)
  },
  async ({ calendarId, from, to, query, maxResults }) => {
    const { items = [] } = await google(events(calendarId), { params: {
      timeMin: from ? instant(from) : new Date().toISOString(), maxResults, singleEvents: true, orderBy: "startTime",
      ...(to && { timeMax: instant(to) }), ...(query && { q: query })
    } });
    // one budget for the whole list, so a busy week cannot flood a small model's context
    return items.map((item) => brief(item, 20_000 / items.length));
  });

tool("create_event", "Add an event to a calendar. Google emails an invitation to every guest.", { calendarId, ...fields },
  async ({ calendarId, ...input }) => brief(await google(events(calendarId), { method: "POST", params: changes, data: body(input) })));

tool("update_event", "Change an event. Fields left out stay as they are, and attendees replaces the whole guest list. Google emails every guest about the change.",
  { calendarId, eventId: z.string(), ...Object.fromEntries(Object.entries(fields).map(([name, type]) => [name, type.optional()])) },
  async ({ calendarId, eventId, ...input }) => {
    // a patch would merge the old all day date into a new start time, so replace the whole event
    const current = await google(at(calendarId, eventId));
    return brief(await google(at(calendarId, eventId), {
      method: "PUT", params: changes, headers: { "If-Match": current.etag }, data: { ...current, ...body(input, current) }
    }));
  });

tool("delete_event", "Delete an event. When the owner organizes it, Google tells every guest it is cancelled.", { calendarId, eventId: z.string() },
  async ({ calendarId, eventId }) => {
    await google(at(calendarId, eventId), { method: "DELETE", params: { sendUpdates: "all" } });
    return { deleted: eventId };
  });

tool("respond_to_event", "Accept, decline or maybe an invitation on that calendar. The organizer is told.",
  { calendarId, eventId: z.string(), response: z.enum(["accepted", "declined", "tentative"]) },
  async ({ calendarId, eventId, response }) => {
    const { attendees = [] } = await google(at(calendarId, eventId));
    const self = attendees.find((guest) => guest.self);
    if (!self) throw new Error("That calendar is not a guest on that event, so there is no invitation to answer");
    self.responseStatus = response;
    return brief(await google(at(calendarId, eventId), { method: "PATCH", params: { sendUpdates: "all" }, data: { attendees } }));
  });

tool("check_availability", "Busy times in a window for the owner and for anyone whose calendar they can see.",
  { calendars: z.string().default("primary").describe("Calendar ids or people's emails, comma separated"), from: z.string(), to: z.string() },
  async ({ calendars, from, to }) => {
    const answer = await google("freeBusy", { method: "POST", data: {
      timeMin: instant(from), timeMax: instant(to), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, items: list(calendars).map((id) => ({ id }))
    } });
    // a calendar Google could not read still comes back with no busy times, which reads as free
    return Object.fromEntries(Object.entries(answer.calendars ?? {}).map(([id, { busy, errors }]) =>
      [id, errors ? `unknown, Google says ${errors.map(({ reason }) => reason).join(", ")}` : busy]));
  });

await serve();
