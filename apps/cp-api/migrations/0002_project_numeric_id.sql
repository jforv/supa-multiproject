-- Studio addresses projects by a numeric id as well as the ref.
ALTER TABLE projects ADD COLUMN id integer GENERATED ALWAYS AS IDENTITY UNIQUE;
