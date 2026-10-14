alter table public.documents
  add column content_size_bytes bigint;

alter table public.documents
  add constraint documents_content_size_nonnegative
  check (content_size_bytes is null or content_size_bytes >= 0);

comment on column public.documents.content_size_bytes is
  'Exact number of bytes downloaded from the SEC and archived in private Storage.';
