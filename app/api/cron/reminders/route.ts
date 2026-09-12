import { processReminders } from "../../../../lib/reminders";

export async function GET(request: Request) {
  return processReminders(request);
}

export async function POST(request: Request) {
  return processReminders(request);
}
