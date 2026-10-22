create table public.document_text_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id),
  extraction_version text not null,
  source_content_sha256 text not null,
  storage_path text not null unique,
  content_sha256 text not null,
  content_size_bytes bigint not null check (content_size_bytes > 0),
  character_count bigint not null check (character_count > 0),
  line_count integer not null check (line_count > 0),
  created_at timestamptz not null default now(),
  unique (document_id, extraction_version, source_content_sha256)
);

create index document_text_versions_document_created_idx
  on public.document_text_versions (document_id, created_at desc);

alter table public.document_text_versions enable row level security;

comment on table public.document_text_versions is
  'Versioned readable-text artifacts derived from immutable SEC source documents.';

comment on column public.document_text_versions.source_content_sha256 is
  'Fingerprint of the exact original document used as extraction input.';

comment on column public.document_text_versions.extraction_version is
  'Version of the deterministic HTML-to-text rules used to create this artifact.';
