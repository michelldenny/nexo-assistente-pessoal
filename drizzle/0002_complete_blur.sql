CREATE TABLE `card_installments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purchase_id` integer NOT NULL,
	`card_id` integer NOT NULL,
	`installment_number` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`invoice_month` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`paid_at` text,
	FOREIGN KEY (`purchase_id`) REFERENCES `card_purchases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`card_id`) REFERENCES `credit_cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_card_installments_invoice` ON `card_installments` (`card_id`,`invoice_month`);--> statement-breakpoint
CREATE INDEX `idx_card_installments_purchase` ON `card_installments` (`purchase_id`);--> statement-breakpoint
CREATE TABLE `card_invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` integer NOT NULL,
	`reference_month` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`paid_at` text,
	FOREIGN KEY (`card_id`) REFERENCES `credit_cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_card_invoices_card_month` ON `card_invoices` (`card_id`,`reference_month`);--> statement-breakpoint
CREATE TABLE `card_purchases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` integer NOT NULL,
	`description` text NOT NULL,
	`category` text DEFAULT 'Outros' NOT NULL,
	`purchase_date` text NOT NULL,
	`total_cents` integer NOT NULL,
	`installment_count` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`card_id`) REFERENCES `credit_cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_card_purchases_card_date` ON `card_purchases` (`card_id`,`purchase_date`);--> statement-breakpoint
CREATE TABLE `credit_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`bank` text NOT NULL,
	`last_four` text NOT NULL,
	`credit_limit_cents` integer NOT NULL,
	`closing_day` integer NOT NULL,
	`due_day` integer NOT NULL,
	`color` text DEFAULT 'green' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text
);
