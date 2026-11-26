-- HOMEBOUND follow-up migration: 2026-11-26
-- Apply AFTER the November 2026 Homebound schema.sql has succeeded.
-- Non-destructive: no DROP TABLE or deletion of property/tenant/payment records.
BEGIN;

-- Only notices explicitly approved for public display may appear on the
-- student homepage. Targeted tenant announcements remain private.
ALTER TABLE public.tenant_announcements
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

-- One atomic rental assignment: a valid expected move-out is mandatory.
-- A failure updating the projected availability rolls back the tenancy insert
-- AND any linked bed/hold/reservation changes together.
CREATE OR REPLACE FUNCTION public.homebound_assign_bed_with_moveout(
  p_listing_id uuid, p_room_name text, p_bed_slot text,
  p_tenant_name text, p_phone text, p_email text, p_start_date date,
  p_due_day integer, p_monthly_rent numeric, p_hold_id uuid,
  p_planned_end_date date
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.landlords l WHERE l.user_id=auth.uid()
  ) THEN RAISE EXCEPTION 'Approved landlord login required.'; END IF;
  IF p_planned_end_date IS NULL
    OR p_planned_end_date < CURRENT_DATE
    OR p_planned_end_date < p_start_date
    OR p_planned_end_date > CURRENT_DATE + 730 THEN
    RAISE EXCEPTION 'Expected move-out is required and must be within the next two years, on or after move-in.';
  END IF;
  v_id := public.homebound_assign_bed(p_listing_id,p_room_name,p_bed_slot,
    p_tenant_name,p_phone,p_email,p_start_date,p_due_day,p_monthly_rent,p_hold_id);
  PERFORM public.homebound_set_expected_moveout(v_id,p_planned_end_date);
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.homebound_assign_bed_with_moveout(
  uuid,text,text,text,text,text,date,integer,numeric,uuid,date
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.homebound_assign_bed_with_moveout(
  uuid,text,text,text,text,text,date,integer,numeric,uuid,date
) TO authenticated;

-- Preserve private announcement snapshots. Public visibility is a distinct
-- opt-in; only all-tenant notices may be made public on the student homepage.
CREATE OR REPLACE FUNCTION public.homebound_publish_announcement_v2(
  p_listing_id uuid, p_title text, p_body text, p_is_public boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.landlords l WHERE l.user_id=auth.uid()
  ) THEN RAISE EXCEPTION 'Approved landlord required.'; END IF;
  IF COALESCE(p_is_public,false) AND p_listing_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only all-tenant notices can be displayed publicly.';
  END IF;
  v_result := public.homebound_publish_announcement(p_listing_id,p_title,p_body);
  IF COALESCE(p_is_public,false) THEN
    UPDATE public.tenant_announcements
      SET is_public=true
      WHERE id=(v_result->>'id')::uuid AND owner_id=auth.uid();
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.homebound_publish_announcement_v2(uuid,text,text,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.homebound_publish_announcement_v2(uuid,text,text,boolean)
  TO authenticated;

-- Public feed provides ONLY opted-in public announcement content.
-- No recipient, landlord auth, private tenancy, phone, or token data.
CREATE OR REPLACE FUNCTION public.homebound_public_announcements()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',a.id,'title',a.title,'body',a.body,'created_at',a.created_at
  ) ORDER BY a.created_at DESC),'[]'::jsonb)
  FROM (SELECT id,title,body,created_at
        FROM public.tenant_announcements
        WHERE is_public=true
        ORDER BY created_at DESC LIMIT 20) a;
$$;
REVOKE ALL ON FUNCTION public.homebound_public_announcements()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.homebound_public_announcements()
  TO anon, authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';