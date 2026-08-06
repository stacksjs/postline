ALTER TABLE "blog_posts" ADD COLUMN "access" TEXT CHECK ("access" IN ('free', 'paid')) not null default 'free';
ALTER TABLE "blog_posts" ADD COLUMN "preview_chars" INTEGER not null default 600;
