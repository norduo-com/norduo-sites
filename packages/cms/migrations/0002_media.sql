CREATE TABLE `media_refs` (
	`media_id` text NOT NULL,
	`doc_type` text NOT NULL,
	`doc_slug` text NOT NULL,
	`locale` text NOT NULL,
	PRIMARY KEY(`media_id`, `doc_type`, `doc_slug`, `locale`),
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `media_refs_doc` ON `media_refs` (`doc_type`,`doc_slug`);--> statement-breakpoint
ALTER TABLE `media` ADD `lqip` text;