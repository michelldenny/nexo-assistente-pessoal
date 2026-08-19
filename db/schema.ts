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

export const creditCards = sqliteTable("credit_cards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  bank: text("bank").notNull(),
  lastFour: text("last_four").notNull(),
  creditLimitCents: integer("credit_limit_cents").notNull(),
  closingDay: integer("closing_day").notNull(),
  dueDay: integer("due_day").notNull(),
  color: text("color").notNull().default("green"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  deletedAt: text("deleted_at"),
});

export const cardPurchases = sqliteTable("card_purchases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cardId: integer("card_id").notNull().references(() => creditCards.id),
  description: text("description").notNull(),
  category: text("category").notNull().default("Outros"),
  purchaseDate: text("purchase_date").notNull(),
  totalCents: integer("total_cents").notNull(),
  installmentCount: integer("installment_count").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  deletedAt: text("deleted_at"),
}, (table) => [index("idx_card_purchases_card_date").on(table.cardId, table.purchaseDate)]);

export const cardInstallments = sqliteTable("card_installments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  purchaseId: integer("purchase_id").notNull().references(() => cardPurchases.id),
  cardId: integer("card_id").notNull().references(() => creditCards.id),
  installmentNumber: integer("installment_number").notNull(),
  amountCents: integer("amount_cents").notNull(),
  invoiceMonth: text("invoice_month").notNull(),
  status: text("status", { enum: ["pending", "paid"] }).notNull().default("pending"),
  paidAt: text("paid_at"),
}, (table) => [
  index("idx_card_installments_invoice").on(table.cardId, table.invoiceMonth),
  index("idx_card_installments_purchase").on(table.purchaseId),
]);

export const cardInvoices = sqliteTable("card_invoices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cardId: integer("card_id").notNull().references(() => creditCards.id),
  referenceMonth: text("reference_month").notNull(),
  status: text("status", { enum: ["open", "paid"] }).notNull().default("open"),
  paidAt: text("paid_at"),
}, (table) => [index("idx_card_invoices_card_month").on(table.cardId, table.referenceMonth)]);
