-- TYPE: schema
-- Postgres has no built-in DROP VALUE for enums; rolling this back requires
-- rewriting the enum type. We leave the value in place — harmless if unused.
SELECT 1;
