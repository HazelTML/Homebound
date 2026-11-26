-- HOMEBOUND date-range calendar migration. Run AFTER existing schema.sql and November 26 migrations.
-- Existing tenancy and payment history is preserved.
BEGIN;
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE public.advance_reservations ADD COLUMN IF NOT EXISTS move_out_date date;
-- Older requests had no checkout date. Mark them for review, and reserve
-- a conservative up-to-one-year window for previously approved requests.
-- Do not silently treat any inferred end date as the student's actual plan.
ALTER TABLE public.advance_reservations ADD COLUMN IF NOT EXISTS period_needs_review boolean NOT NULL DEFAULT false;
UPDATE public.advance_reservations
 SET period_needs_review=true,
     move_out_date=move_in_date + CASE WHEN status='Approved' THEN 365 ELSE 30 END
 WHERE move_out_date IS NULL;
ALTER TABLE public.advance_reservations ALTER COLUMN move_out_date SET NOT NULL;
ALTER TABLE public.advance_reservations DROP CONSTRAINT IF EXISTS hb_advance_valid_stay;
ALTER TABLE public.advance_reservations ADD CONSTRAINT hb_advance_valid_stay
 CHECK (move_out_date > move_in_date AND move_out_date <= move_in_date+365);
-- Replace the previous one-approved-booking-per-bed rule with date-range exclusion.
DROP INDEX IF EXISTS public.homebound_one_approved_advance_per_bed;
ALTER TABLE public.advance_reservations DROP CONSTRAINT IF EXISTS hb_advance_nonoverlap;
ALTER TABLE public.advance_reservations ADD CONSTRAINT hb_advance_nonoverlap
 EXCLUDE USING gist (listing_id WITH =, room_name WITH =, bed_slot WITH =,
    daterange(move_in_date,move_out_date,'[)') WITH &&)
 WHERE (status='Approved');

-- Safe public calendar: returns only dates and labels, never tenant names/contact.
CREATE OR REPLACE FUNCTION public.homebound_calendar_dates(
 p_listing_id uuid,p_room_name text,p_bed_slot text,p_month date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_bed jsonb; v_start date; v_end date; v_result jsonb;
BEGIN
 IF p_month IS NULL OR p_month < date_trunc('month',(now() at time zone 'Asia/Manila')::date)::date - interval '1 month'
    OR p_month > (now() at time zone 'Asia/Manila')::date+interval '19 months' THEN RAISE EXCEPTION 'Invalid calendar month.'; END IF;
 SELECT b.bed INTO v_bed FROM public.listings l
 CROSS JOIN LATERAL jsonb_array_elements(l.rooms) r(room)
 CROSS JOIN LATERAL jsonb_array_elements(r.room->'beds') b(bed)
 WHERE l.id=p_listing_id AND r.room->>'name'=p_room_name AND b.bed->>'id'=p_bed_slot LIMIT 1;
 IF v_bed IS NULL THEN RAISE EXCEPTION 'Bed not found.'; END IF;
 v_start=date_trunc('month',p_month)::date;
 v_end=(v_start+interval '1 month')::date;
 SELECT coalesce(jsonb_agg(jsonb_build_object('date',day::date,'status',state,
     'label',CASE state WHEN 'occupied' THEN 'Occupied' WHEN 'reserved' THEN 'Reserved'
      WHEN 'blocked' THEN 'Unavailable' WHEN 'expected' THEN 'Expected vacancy; owner confirmation required'
      ELSE 'Available' END) ORDER BY day),'[]'::jsonb)
 INTO v_result
 FROM (
  SELECT days.day, CASE
   WHEN EXISTS (SELECT 1 FROM public.tenancies t
      WHERE t.listing_id=p_listing_id AND t.room_name=p_room_name AND t.bed_slot=p_bed_slot
        AND t.start_date<=days.day
        AND (CASE WHEN t.status='Ended' THEN coalesce(t.end_date,t.start_date)
                  ELSE coalesce(t.planned_end_date,'infinity'::date) END)>=days.day)
       THEN 'occupied'
   WHEN EXISTS (SELECT 1 FROM public.advance_reservations a
      WHERE a.listing_id=p_listing_id AND a.room_name=p_room_name AND a.bed_slot=p_bed_slot
       AND a.status='Approved' AND days.day >= a.move_in_date AND days.day < a.move_out_date)
       THEN 'reserved'
   WHEN v_bed->>'status'='Unavailable' THEN 'blocked'
   WHEN v_bed->>'status'='Occupied' AND NOT EXISTS (SELECT 1 FROM public.tenancies t
      WHERE t.listing_id=p_listing_id AND t.room_name=p_room_name AND t.bed_slot=p_bed_slot AND t.status='Active') THEN 'blocked'
   WHEN v_bed->>'status'='Occupied' AND EXISTS (SELECT 1 FROM public.tenancies t
      WHERE t.listing_id=p_listing_id AND t.room_name=p_room_name AND t.bed_slot=p_bed_slot
       AND t.status='Active' AND t.planned_end_date IS NOT NULL AND days.day>t.planned_end_date) THEN 'expected'
   WHEN v_bed->>'status'='Occupied' AND EXISTS (SELECT 1 FROM public.tenancies t
      WHERE t.listing_id=p_listing_id AND t.room_name=p_room_name AND t.bed_slot=p_bed_slot
       AND t.status='Active' AND days.day<t.start_date) THEN 'available'
   WHEN v_bed->>'status'='Occupied' THEN 'occupied'
   ELSE 'available' END AS state
  FROM generate_series(v_start::timestamp,(v_end-1)::timestamp, interval '1 day') days(day)
 ) q;
 RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.homebound_calendar_dates(uuid,text,text,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.homebound_calendar_dates(uuid,text,text,date) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.homebound_calendar_check(
 p_listing_id uuid,p_room_name text,p_bed_slot text,p_start date,p_end date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_bed jsonb; v_conflict boolean; v_reason text;
BEGIN
 IF p_start IS NULL OR p_end IS NULL OR p_start <= (now() at time zone 'Asia/Manila')::date OR p_end<=p_start
    OR p_end>(now() at time zone 'Asia/Manila')::date+366 THEN RETURN jsonb_build_object('available',false,'reason','Choose future dates within one year.'); END IF;
 SELECT b.bed INTO v_bed FROM public.listings l
 CROSS JOIN LATERAL jsonb_array_elements(l.rooms) r(room)
 CROSS JOIN LATERAL jsonb_array_elements(r.room->'beds') b(bed)
 WHERE l.id=p_listing_id AND r.room->>'name'=p_room_name AND b.bed->>'id'=p_bed_slot LIMIT 1;
 IF v_bed IS NULL OR v_bed->>'status'='Unavailable' THEN
   RETURN jsonb_build_object('available',false,'reason','This bed is unavailable.'); END IF;
 SELECT EXISTS(SELECT 1 FROM public.tenancies t
  WHERE t.listing_id=p_listing_id AND t.room_name=p_room_name AND t.bed_slot=p_bed_slot
   AND daterange(t.start_date, (CASE WHEN t.status='Ended' THEN coalesce(t.end_date,t.start_date)
       ELSE coalesce(t.planned_end_date,'infinity'::date) END)+1,'[)') && daterange(p_start,p_end,'[)'))
 INTO v_conflict;
 IF v_conflict THEN RETURN jsonb_build_object('available',false,'reason','An existing tenant occupies part of that period.');END IF;
 SELECT EXISTS(SELECT 1 FROM public.advance_reservations a
  WHERE a.listing_id=p_listing_id AND a.room_name=p_room_name AND a.bed_slot=p_bed_slot
   AND a.status='Approved' AND daterange(a.move_in_date,a.move_out_date,'[)') && daterange(p_start,p_end,'[)'))
 INTO v_conflict;
 IF v_conflict THEN RETURN jsonb_build_object('available',false,'reason','Those dates overlap an approved reservation.');END IF;
 IF v_bed->>'status'='Occupied' AND NOT EXISTS (SELECT 1 FROM public.tenancies t WHERE t.listing_id=p_listing_id AND t.room_name=p_room_name AND t.bed_slot=p_bed_slot AND t.status='Active') THEN
   RETURN jsonb_build_object('available',false,'reason','Bed occupancy requires landlord review.');END IF;
 RETURN jsonb_build_object('available',true);
END;
$$;
REVOKE ALL ON FUNCTION public.homebound_calendar_check(uuid,text,text,date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.homebound_calendar_check(uuid,text,text,date,date) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.homebound_request_advance_range(
 p_listing_id uuid,p_room_name text,p_bed_slot text,p_start date,p_end date,
 p_student_name text,p_student_phone text,p_student_email text,p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_listing public.listings%ROWTYPE; v_check jsonb; v_id uuid;
BEGIN
 IF p_token IS NULL OR length(btrim(coalesce(p_student_name,''))) NOT BETWEEN 2 AND 150
    OR length(btrim(coalesce(p_student_phone,''))) NOT BETWEEN 7 AND 35
    OR length(btrim(coalesce(p_student_email,''))) NOT BETWEEN 4 AND 250
    OR p_student_email NOT LIKE '%@%' THEN RAISE EXCEPTION 'Invalid student contact information.';END IF;
 SELECT * INTO v_listing FROM public.listings WHERE id=p_listing_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Property not found.';END IF;
 v_check:=public.homebound_calendar_check(p_listing_id,p_room_name,p_bed_slot,p_start,p_end);
 IF (v_check->>'available')::boolean IS NOT TRUE THEN RAISE EXCEPTION '%',v_check->>'reason';END IF;
 IF (SELECT count(*) FROM public.advance_reservations WHERE lower(student_email)=lower(p_student_email)
     AND created_at>now()-interval '24 hours') >= 5 THEN RAISE EXCEPTION 'Daily request limit reached.'; END IF;
 INSERT INTO public.advance_reservations(listing_id,owner_id,room_name,bed_slot,move_in_date,move_out_date,
 student_name,student_phone,student_email,student_token)
 VALUES(p_listing_id,v_listing.owner_id,p_room_name,p_bed_slot,p_start,p_end,
 btrim(p_student_name),btrim(p_student_phone),btrim(p_student_email),p_token) RETURNING id INTO v_id;
 RETURN jsonb_build_object('id',v_id,'status','Pending');
END;
$$;
REVOKE ALL ON FUNCTION public.homebound_request_advance_range(uuid,text,text,date,date,text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.homebound_request_advance_range(uuid,text,text,date,date,text,text,text,uuid) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.homebound_owner_set_advance_range_status(p_id uuid,p_status text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.advance_reservations%ROWTYPE; v_check jsonb; v_rooms jsonb; v_first date;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.landlords l WHERE l.user_id=auth.uid()) THEN
  RAISE EXCEPTION 'Approved landlord required.';END IF;
 IF p_status NOT IN ('Approved','Declined','Cancelled') THEN RAISE EXCEPTION 'Invalid status.';END IF;
 SELECT * INTO a FROM public.advance_reservations WHERE id=p_id AND owner_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RETURN false;END IF;
 IF NOT ((a.status='Pending' AND p_status IN ('Approved','Declined')) OR
    (a.status='Approved' AND p_status='Cancelled')) THEN RETURN false;END IF;
 SELECT rooms INTO v_rooms FROM public.listings WHERE id=a.listing_id FOR UPDATE;
 IF p_status='Approved' AND a.period_needs_review THEN
   RAISE EXCEPTION 'Older request has no recorded checkout date; decline it and ask the student to submit a new date range.';
 END IF;
 IF p_status='Approved' THEN
   v_check:=public.homebound_calendar_check(a.listing_id,a.room_name,a.bed_slot,a.move_in_date,a.move_out_date);
   IF (v_check->>'available')::boolean IS NOT TRUE THEN RAISE EXCEPTION '%',v_check->>'reason';END IF;
 END IF;
 UPDATE public.advance_reservations SET status=p_status WHERE id=p_id;
 -- Keep legacy public bed reservedFor marker as the EARLIEST approved start date.
 SELECT min(move_in_date) INTO v_first FROM public.advance_reservations
 WHERE listing_id=a.listing_id AND room_name=a.room_name AND bed_slot=a.bed_slot AND status='Approved';
 UPDATE public.listings SET rooms=public.homebound_write_bed_reservation(v_rooms,a.room_name,a.bed_slot,v_first)
 WHERE id=a.listing_id;
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.homebound_owner_set_advance_range_status(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.homebound_owner_set_advance_range_status(uuid,text) TO authenticated;
-- Block outdated one-date reservation APIs from bypassing date-range rules.
CREATE OR REPLACE FUNCTION public.homebound_owner_set_advance_status(p_id uuid,p_status text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public.homebound_owner_set_advance_range_status(p_id,p_status);
$$;
CREATE OR REPLACE FUNCTION public.homebound_request_advance(
 p_listing_id uuid,p_room_name text,p_bed_slot text,p_move_in_date date,
 p_student_name text,p_student_phone text,p_student_email text,p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RAISE EXCEPTION 'Update Homebound to select a move-in and checkout date range.';
END;
$$;
COMMIT;
NOTIFY pgrst,'reload schema';