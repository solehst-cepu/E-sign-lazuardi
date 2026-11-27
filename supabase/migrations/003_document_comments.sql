-- ============================================================================
-- LAZUARDI e-SIGN — Document Comments Table Migration
-- Enables interactive review & pre-signature discussion comments per document
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.document_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number >= 1),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  author_name text NOT NULL,
  author_job_title text NOT NULL DEFAULT '',
  author_role text NOT NULL DEFAULT '',
  page_number integer CHECK (page_number IS NULL OR page_number >= 1),
  comment text NOT NULL CHECK (length(trim(comment)) >= 1),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_comments_doc_created
  ON public.document_comments (document_id, created_at ASC);

ALTER TABLE public.document_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read accessible document comments" ON public.document_comments;
CREATE POLICY "Users can read accessible document comments" ON public.document_comments
  FOR SELECT TO authenticated
  USING (public.user_can_access_document(document_id));

DROP POLICY IF EXISTS "Authorized users can insert document comments" ON public.document_comments;
CREATE POLICY "Authorized users can insert document comments" ON public.document_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.user_can_access_document(document_id)
  );

GRANT SELECT, INSERT ON TABLE public.document_comments TO authenticated;
GRANT ALL ON TABLE public.document_comments TO postgres, service_role;
