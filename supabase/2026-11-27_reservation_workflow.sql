-- Apply AFTER 2026-11-27_occupancy_calendar.sql. Back up before migration.
-- Keeps visitation holds separate. Approval records rental terms now, but does not
-- occupy the bed or generate a rent due before the scheduled move-in date.
BEGIN;
ALTER TABLE public.advance_reservations
  ADD COLUMN IF NOT EXISTS monthly_rent numeric(12,2),
  ADD COLUMN IF NOT EXISTS due_day integer,
  ADD COLUMN IF NOT EXISTS offered_start date,
  ADD COLUMN IF NOT EXISTS offered_end date,
  ADD COLUMN IF NOT EXISTS offer_message text,
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.chat_conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS activated_tenancy_id uuid REFERENCES public.tenancies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz;
ALTER TABLE public.advance_reservations DROP CONSTRAINT IF EXISTS advance_reservations_status_check;
ALTER TABLE public.advance_reservations ADD CONSTRAINT advance_reservations_status_check
 CHECK (status IN ('Pending','Approved','Declined','Cancelled','Fulfilled','Alternative Offered'));
ALTER TABLE public.advance_reservations DROP CONSTRAINT IF EXISTS hb_advance_rent_valid;
ALTER TABLE public.advance_reservations ADD CONSTRAINT hb_advance_rent_valid
 CHECK ((monthly_rent IS NULL OR monthly_rent > 0) AND (due_day IS NULL OR due_day BETWEEN 1 AND 31));
-- Older approved records have no rent agreement: they remain reserved but need
-- landlord review; the activation job deliberately skips them until completed.

-- Booking request creates or reuses a token-owned student conversation in the same transaction.
CREATE OR REPLACE FUNCTION public.homebound_request_reservation_chat(
 p_listing_id uuid, p_room_name text, p_bed_slot text, p_start date, p_end date,
 p_student_name text, p_student_phone text, p_student_email text, p_token uuid,
 p_chat_token uuid, p_conversation_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result jsonb; v_conversation uuid; v_owner uuid;
BEGIN
 IF p_chat_token IS NULL THEN RAISE EXCEPTION 'Missing private conversation token.'; END IF;
 SELECT owner_id INTO v_owner FROM public.listings WHERE id=p_listing_id;
 IF v_owner IS NULL THEN RAISE EXCEPTION 'Listing not found.'; END IF;
 IF p_conversation_id IS NOT NULL THEN
   SELECT id INTO v_conversation FROM public.chat_conversations
   WHERE id=p_conversation_id AND listing_id=p_listing_id AND student_token=p_chat_token;
   IF v_conversation IS NULL THEN RAISE EXCEPTION 'Conversation token mismatch.'; END IF;
 ELSE
   INSERT INTO public.chat_conversations(listing_id,owner_id,student_token)
   VALUES(p_listing_id,v_owner,p_chat_token) RETURNING id INTO v_conversation;
 END IF;
 v_result := public.homebound_request_advance_range(p_listing_id,p_room_name,p_bed_slot,
   p_start,p_end,p_student_name,p_student_phone,p_student_email,p_token);
 UPDATE public.advance_reservations SET conversation_id=v_conversation
 WHERE id=(v_result->>'id')::uuid;
 INSERT INTO public.chat_messages(conversation_id,sender,body)
 VALUES(v_conversation,'student',left('Advance reservation requested: '||p_room_name||
       ' / '||p_bed_slot||' ('||p_start||' to '||p_end||' checkout).',2000));
 RETURN v_result || jsonb_build_object('conversationId',v_conversation);
END;
$$;
REVOKE ALL ON FUNCTION public.homebound_request_reservation_chat(uuid,text,text,date,date,text,text,text,uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.homebound_request_reservation_chat(uuid,text,text,date,date,text,text,text,uuid,uuid,uuid)
 TO anon,authenticated;

-- Returns only the requesting student's private reservation status.
CREATE OR REPLACE FUNCTION public.homebound_advance_status(p_id uuid,p_token uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',a.id,'status',a.status,
 'move_in_date',a.move_in_date,'move_out_date',a.move_out_date,
 'offered_start',a.offered_start,'offered_end',a.offered_end,
 'offer_message',a.offer_message,'conversation_id',a.conversation_id,
 'activated',a.activated_tenancy_id IS NOT NULL)
 FROM public.advance_reservations a WHERE a.id=p_id AND a.student_token=p_token;
$$;
REVOKE ALL ON FUNCTION public.homebound_advance_status(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.homebound_advance_status(uuid,uuid) TO anon,authenticated;

-- Approved reservation must have its rent terms recorded before approval.
-- The listing row lock serializes concurrent decisions for the same property.
CREATE OR REPLACE FUNCTION public.homebound_review_reservation(
 p_id uuid,p_action text,p_monthly_rent numeric DEFAULT NULL,p_due_day integer DEFAULT NULL,
 p_offer_start date DEFAULT NULL,p_offer_end date DEFAULT NULL,p_message text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.advance_reservations%ROWTYPE; v_rooms jsonb; v_first date; v_check jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.landlords WHERE user_id=auth.uid())
 THEN RAISE EXCEPTION 'Approved landlord required.'; END IF;
 IF p_action NOT IN ('Approved','Declined','Alternative Offered','Cancelled')
 THEN RAISE EXCEPTION 'Invalid decision.'; END IF;
 SELECT * INTO a FROM public.advance_reservations WHERE id=p_id AND owner_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF NOT ((a.status='Pending' AND p_action IN ('Approved','Declined','Alternative Offered'))
   OR (a.status='Declined' AND p_action='Alternative Offered')
   OR (a.status='Approved' AND p_action='Cancelled')) THEN RETURN false; END IF;
 SELECT rooms INTO v_rooms FROM public.listings WHERE id=a.listing_id FOR UPDATE;
 IF p_action='Approved' THEN
   IF a.period_needs_review THEN RAISE EXCEPTION 'Request dates need review. Ask student for a new date range.'; END IF;
   IF p_monthly_rent IS NULL OR p_monthly_rent <= 0 OR p_monthly_rent > 10000000
      OR p_due_day IS NULL OR p_due_day NOT BETWEEN 1 AND 31 THEN
     RAISE EXCEPTION 'Enter a valid monthly rent and due day before approving.';
   END IF;
   v_check:=public.homebound_calendar_check(a.listing_id,a.room_name,a.bed_slot,a.move_in_date,a.move_out_date);
   IF (v_check->>'available')::boolean IS NOT TRUE THEN RAISE EXCEPTION '%',v_check->>'reason'; END IF;
   UPDATE public.advance_reservations SET status='Approved',monthly_rent=p_monthly_rent,
      due_day=p_due_day,offered_start=NULL,offered_end=NULL,offer_message=NULL WHERE id=p_id;
 ELSIF p_action='Alternative Offered' THEN
   IF p_offer_start IS NULL OR p_offer_end IS NULL OR p_offer_start<= (now() at time zone 'Asia/Manila')::date
      OR p_offer_end<=p_offer_start OR p_offer_end>p_offer_start+365 THEN
     RAISE EXCEPTION 'Offer a valid future start and checkout date.'; END IF;
   v_check:=public.homebound_calendar_check(a.listing_id,a.room_name,a.bed_slot,p_offer_start,p_offer_end);
   IF (v_check->>'available')::boolean IS NOT TRUE THEN RAISE EXCEPTION '%',v_check->>'reason';END IF;
   UPDATE public.advance_reservations SET status='Alternative Offered',offered_start=p_offer_start,
     offered_end=p_offer_end,offer_message=left(coalesce(p_message,''),300) WHERE id=p_id;
 ELSE
   UPDATE public.advance_reservations SET status=p_action WHERE id=p_id;
 END IF;
 -- Do not destroy any other reservations on the same bed.
 SELECT min(move_in_date) INTO v_first FROM public.advance_reservations
 WHERE listing_id=a.listing_id AND room_name=a.room_name AND bed_slot=a.bed_slot AND status='Approved';
 UPDATE public.listings SET rooms=public.homebound_write_bed_reservation(v_rooms,a.room_name,a.bed_slot,v_first)
 WHERE id=a.listing_id;
 IF a.conversation_id IS NOT NULL THEN
   INSERT INTO public.chat_messages(conversation_id,sender,body)
   VALUES(a.conversation_id,'owner',left(CASE p_action
      WHEN 'Approved' THEN 'Reservation approved: '||a.move_in_date||' to '||a.move_out_date||' checkout. Rent terms recorded; rent starts after move-in activation.'
      WHEN 'Declined' THEN 'Reservation declined. You can message the owner about other dates.'
      WHEN 'Alternative Offered' THEN 'Alternative dates offered: '||p_offer_start||' to '||p_offer_end||' checkout. '||coalesce(p_message,'')||' Open this conversation to accept or decline.'
      ELSE 'The approved reservation was cancelled.' END,2000));
 END IF;
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.homebound_review_reservation(uuid,text,numeric,integer,date,date,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.homebound_review_reservation(uuid,text,numeric,integer,date,date,text) TO authenticated;

-- Existing approved reservations from earlier versions may need their rent terms
-- completed; their dates must already have been explicitly confirmed.
CREATE OR REPLACE FUNCTION public.homebound_finalize_reservation_rent(
 p_id uuid,p_monthly_rent numeric,p_due_day integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.advance_reservations%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.landlords WHERE user_id=auth.uid())
 THEN RAISE EXCEPTION 'Approved landlord required.';END IF;
 SELECT * INTO a FROM public.advance_reservations WHERE id=p_id AND owner_id=auth.uid() FOR UPDATE;
 IF NOT FOUND OR a.status<>'Approved' OR a.activated_tenancy_id IS NOT NULL THEN RETURN false;END IF;
 IF a.period_needs_review THEN RAISE EXCEPTION 'Dates are provisional. Cancel and request a new date range.'; END IF;
 IF p_monthly_rent IS NULL OR p_monthly_rent<=0 OR p_monthly_rent>10000000
    OR p_due_day IS NULL OR p_due_day NOT BETWEEN 1 AND 31 THEN RAISE EXCEPTION 'Invalid rent terms.';END IF;
 UPDATE public.advance_reservations SET monthly_rent=p_monthly_rent,due_day=p_due_day WHERE id=p_id;
 IF a.conversation_id IS NOT NULL THEN
   INSERT INTO public.chat_messages(conversation_id,sender,body) VALUES
   (a.conversation_id,'owner','Rent terms are now recorded for your approved reservation.');
 END IF;
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.homebound_finalize_reservation_rent(uuid,numeric,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.homebound_finalize_reservation_rent(uuid,numeric,integer) TO authenticated;

-- Do not allow old clients to approve reservations without capturing rent details.
CREATE OR REPLACE FUNCTION public.homebound_owner_set_advance_range_status(p_id uuid,p_status text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_status='Approved' THEN RAISE EXCEPTION 'Update Homebound to record rent terms when approving.';END IF;
 RETURN public.homebound_review_reservation(p_id,p_status,NULL,NULL,NULL,NULL,NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.homebound_respond_reservation_offer(p_id uuid,p_token uuid,p_accept boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.advance_reservations%ROWTYPE; v_check jsonb;
BEGIN
 SELECT * INTO a FROM public.advance_reservations WHERE id=p_id AND student_token=p_token FOR UPDATE;
 IF NOT FOUND OR a.status<>'Alternative Offered' THEN RAISE EXCEPTION 'Offer is no longer available.';END IF;
 IF p_accept THEN
   v_check:=public.homebound_calendar_check(a.listing_id,a.room_name,a.bed_slot,a.offered_start,a.offered_end);
   IF (v_check->>'available')::boolean IS NOT TRUE THEN RAISE EXCEPTION '%',v_check->>'reason';END IF;
   UPDATE public.advance_reservations SET move_in_date=offered_start,move_out_date=offered_end,
      offered_start=NULL,offered_end=NULL,offer_message=NULL,status='Pending' WHERE id=p_id;
 ELSE
   UPDATE public.advance_reservations SET status='Declined' WHERE id=p_id;
 END IF;
 IF a.conversation_id IS NOT NULL THEN
   INSERT INTO public.chat_messages(conversation_id,sender,body)
   VALUES(a.conversation_id,'student',CASE WHEN p_accept THEN
   'I accept the offered dates. Please review my updated reservation request.' ELSE
   'I decline the alternative dates. Thank you.' END);
 END IF;
 RETURN jsonb_build_object('status',CASE WHEN p_accept THEN 'Pending' ELSE 'Declined' END);
END;
$$;
REVOKE ALL ON FUNCTION public.homebound_respond_reservation_offer(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.homebound_respond_reservation_offer(uuid,uuid,boolean) TO anon,authenticated;

-- Activation is idempotent. It must run on the move-in day (see scheduling below).
-- Existing active tenants are NEVER displaced automatically. If a bed was not
-- actually vacated, activation remains pending until the owner resolves it.
CREATE OR REPLACE FUNCTION public.homebound_activate_due_reservations()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.advance_reservations%ROWTYPE; v_rooms jsonb; v_bed text; v_id uuid; v_count integer:=0; v_next date;
BEGIN
 -- Only internal scheduled jobs or authenticated approved owners may initiate.
 IF session_user NOT IN ('postgres','supabase_admin') AND
    (auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.landlords WHERE user_id=auth.uid()))
 THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 FOR a IN SELECT * FROM public.advance_reservations
   WHERE status='Approved' AND activated_tenancy_id IS NULL
     AND monthly_rent IS NOT NULL AND due_day IS NOT NULL
     AND move_in_date <= (now() at time zone 'Asia/Manila')::date
     AND move_out_date > (now() at time zone 'Asia/Manila')::date
     AND (auth.uid() IS NULL OR owner_id=auth.uid())
   ORDER BY move_in_date,id FOR UPDATE SKIP LOCKED LOOP
   SELECT rooms INTO v_rooms FROM public.listings WHERE id=a.listing_id FOR UPDATE;
   SELECT bed->>'status' INTO v_bed FROM jsonb_array_elements(v_rooms) r
     CROSS JOIN LATERAL jsonb_array_elements(r->'beds') b(bed)
     WHERE r->>'name'=a.room_name AND bed->>'id'=a.bed_slot LIMIT 1;
   IF v_bed IS DISTINCT FROM 'Available' OR EXISTS(
     SELECT 1 FROM public.tenancies t WHERE t.listing_id=a.listing_id AND t.room_name=a.room_name
     AND t.bed_slot=a.bed_slot AND t.status='Active') THEN
      CONTINUE; -- must be manually handed over, not double-booked
   END IF;
   INSERT INTO public.tenancies(owner_id,listing_id,room_name,bed_slot,tenant_name,tenant_phone,
      tenant_email,monthly_rent,start_date,due_day,planned_end_date,status)
   VALUES(a.owner_id,a.listing_id,a.room_name,a.bed_slot,a.student_name,a.student_phone,
      a.student_email,a.monthly_rent,a.move_in_date,a.due_day,a.move_out_date-1,'Active')
   RETURNING id INTO v_id;
   UPDATE public.listings SET rooms=public.homebound_apply_bed_status(v_rooms,a.room_name,a.bed_slot,'Occupied')
      WHERE id=a.listing_id;
   UPDATE public.advance_reservations SET activated_tenancy_id=v_id,activated_at=now(),status='Fulfilled'
      WHERE id=a.id;
   SELECT min(move_in_date) INTO v_next FROM public.advance_reservations
     WHERE listing_id=a.listing_id AND room_name=a.room_name AND bed_slot=a.bed_slot AND status='Approved';
   UPDATE public.listings SET rooms=public.homebound_write_bed_reservation(rooms,a.room_name,a.bed_slot,v_next)
      WHERE id=a.listing_id;
   -- First rent due is the later of move-in and the agreed due day for that month.
   -- Avoid a duplicate due for the same month when standard sync runs.
   INSERT INTO public.rent_payments(owner_id,tenancy_id,due_date,amount_due)
    VALUES(a.owner_id,v_id,GREATEST(a.move_in_date,
     date_trunc('month',a.move_in_date)::date +
     (LEAST(a.due_day,EXTRACT(day FROM (date_trunc('month',a.move_in_date)+interval '1 month - 1 day'))::integer)-1)),
     a.monthly_rent)
    ON CONFLICT(tenancy_id,due_date) DO NOTHING;
   IF a.conversation_id IS NOT NULL THEN
      INSERT INTO public.chat_messages(conversation_id,sender,body) VALUES
       (a.conversation_id,'owner','Your scheduled tenancy has started. Monthly rent tracking is now active.');
   END IF;
   v_count:=v_count+1;
 END LOOP;
 RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.homebound_activate_due_reservations() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.homebound_activate_due_reservations() TO authenticated;
COMMIT;
NOTIFY pgrst,'reload schema';

-- IMPORTANT: For activation even while the site is closed, enable Supabase Cron
-- (pg_cron) in your project's Integrations/Cron and run ONCE:
-- SELECT cron.schedule('homebound-reservation-activate', '* * * * *',
--   $$SELECT public.homebound_activate_due_reservations()$$);
-- Without Cron, approved reservations activate when the owner next opens the
-- dashboard after the move-in day. Activation is guarded against double booking.
