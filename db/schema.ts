import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const transactions = sqliteTable("transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["expense", "income"] }).notNull(),
  description: text("description").notNull(),
  category: text("category").notNull().default("Outros"),
  amountCents: integer("amount_cents").notNull(),
  occurredOn: text("occurred_on").notNull(),
  source: text("source", { enum: ["manual", "assistant"] }).notNull().default("manual"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  deletedAt: text("deleted_at"),
}, (table) => [
  index("idx_transactions_occurred_on").on(table.occurredOn),
  index("idx_transactions_category_date").on(table.category, table.occurredOn),
]);

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;

export const calendarEvents = sqliteTable("calendar_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  eventDate: text("event_date").notNull(),
  startTime: text("start_time"),
  endTime: text("end_time"),
  location: text("location"),
  notes: text("notes"),
  color: text("color").notNull().default("green"),
  status: text("status", { enum: ["scheduled", "completed"] }).notNull().default("scheduled"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  deletedAt: text("deleted_at"),
}, (table) => [
  index("idx_calendar_events_date_status").on(table.eventDate, table.status),
]);

export type CalendarEvent = typeof calendarEvents.$inferSelect;
