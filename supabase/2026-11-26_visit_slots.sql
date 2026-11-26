-- Homebound: exclusive confirmed visits per property/date/hour.
-- Apply to the existing Supabase project after backing up important data.
-- This migration retains hold, conversation, listing and tenancy records.
BEGIN;

-- The owner's status records the moment a confirmed visit has been completed.
ALTER TABLE public.hold_requests DROP CONSTRAINT IF EXISTS hold_requests_status_check;
ALTER TABLE public.hold_requests ADD CONSTRAINT hold_requests_status_check
  CHECK (status IN ('Pending Approval','Confirmed Visit','Declined','Cancelled by Student','Rented','Visited','Expired'));

-- Do not silently change duplicate existing appointments. Alert the owner instead.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.hold_requests
    WHERE status='Confirmed Visit'
    GROUP BY listing_id, visit_date, visit_time
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Homebound has duplicate confirmed visits. Resolve them before enabling exclusive visitation slots.';
  END IF;
END $$;

-- Makes double-approval impossible even if two owner tabs approve at once.
CREATE UNIQUE INDEX IF NOT EXISTS homebound_unique_confirmed_visit_hour
ON public.hold_requests (listing_id, visit_date, visit_time)
WHERE status = 'Confirmed Visit';

-- Student-safe availability API: returns only hour strings, never student data.
CREATE OR REPLACE FUNCTION public.homebound_booked_visit_slots(
  p_listing_id uuid, p_visit_date date
) RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(array_agg(to_char(h.visit_time,'HH24:MI') ORDER BY h.visit_time), ARRAY[]::text[])
  FROM public.hold_requests h
  WHERE h.listing_id = p_listing_id
    AND h.visit_date = p_visit_date
    AND h.status = 'Confirmed Visit'
    AND p_visit_date BETWEEN (now() AT TIME ZONE 'Asia/Manila')::date
        AND (now() AT TIME ZONE 'Asia/Manila')::date + 180;
$$;
REVOKE ALL ON FUNCTION public.homebound_booked_visit_slots(uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.homebound_booked_visit_slots(uuid,date) TO anon,authenticated;

-- Refuse a new pending request if the same time is already confirmed.
-- The unique index above also protects transitions from pending to confirmed.
CREATE OR REPLACE FUNCTION public.homebound_check_visit_slot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'Pending Approval' AND EXISTS (
    SELECT 1 FROM public.hold_requests h
    WHERE h.listing_id = NEW.listing_id
      AND h.visit_date = NEW.visit_date AND h.visit_time = NEW.visit_time
      AND h.status = 'Confirmed Visit' AND h.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'That visitation hour is already booked. Choose another time.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS homebound_check_visit_slot_trigger ON public.hold_requests;
CREATE TRIGGER homebound_check_visit_slot_trigger
BEFORE INSERT OR UPDATE OF status, visit_date, visit_time ON public.hold_requests
FOR EACH ROW EXECUTE FUNCTION public.homebound_check_visit_slot();
REVOKE ALL ON FUNCTION public.homebound_check_visit_slot() FROM PUBLIC, anon, authenticated;

-- Explicit owner action after a physical visit. Keeps the record for reporting,
-- removes the slot from the booked schedule, and notifies the student's chat.
CREATE OR REPLACE FUNCTION public.homebound_complete_visit(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE h public.hold_requests%ROWTYPE;
BEGIN
  UPDATE public.hold_requests
  SET status = 'Visited'
  WHERE id = p_id AND status = 'Confirmed Visit'
    AND owner_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.landlords WHERE user_id = auth.uid())
  RETURNING * INTO h;
  IF NOT FOUND THEN RETURN false; END IF;
  IF h.chat_conversation_id IS NOT NULL THEN
    INSERT INTO public.chat_messages(conversation_id,sender,body)
    VALUES (h.chat_conversation_id, 'system',
      'Homebound update: Your visitation for "' || left(h.room_name,150) || '" on '
       || h.visit_date::text || ' has been marked completed by the owner.');
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.homebound_complete_visit(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.homebound_complete_visit(uuid) TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
