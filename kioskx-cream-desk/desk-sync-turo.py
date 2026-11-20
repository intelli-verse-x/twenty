"""Read the same host mailbox as fleet watch. No posting or provider writes."""
import json, os, re, sys
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
sys.path.insert(0, '/fleet-reader')
from refresh_bookings import _access_token, _plain
from weekly_report import _messages, parse_booking
from daily_activity import car_name, _kind, _guest

def collect(messages):
    trips, threads = [], []
    for subject, header_date, body in messages:
        try:
            at = parsedate_to_datetime(header_date)
            if at.tzinfo is None or at < datetime(2026,11,21,tzinfo=timezone.utc):
                continue  # The founder's browser read supersedes older mail.
        except (ValueError, TypeError):
            continue
        title, text = _plain(subject), _plain(body)
        kind = _kind(title)
        trip = parse_booking(title, text) if kind == 'booked' else None
        trip_id = re.search(r'(?:trip(?:\s+ID|\s+number|\s*#)?\s*[:#]?\s*|/trips?/)(\d{6,12})\b', text, re.I)
        if trip and trip_id:
            trips.append({'id':trip_id[1], 'carId':trip['car_id'], 'guest':trip['guest'].split()[0],
                          'vehicle':trip['name'], 'current':trip['start'] <= datetime.now(trip['start'].tzinfo) < trip['end'],
                          'endLabel':trip['end'].strftime('%d %b %Y at %-I:%M %p'),
                          'startsAt':trip['start'].isoformat(), 'endsAt':trip['end'].isoformat(), 'when':at.isoformat()})
        guest = _guest(title)
        if not guest:
            m = re.match(r'^([A-Za-z][A-Za-z .\'-]{0,40}) has (?:sent you a message|an upcoming trip)', title)
            guest = m[1] if m else None
        car = car_name(title) or car_name(text)
        if guest and car and kind in ('booked','cancel','change','message','upcoming'):
            # Only a first name and event summary: never codes, streets or phones.
            first = guest.split()[0]
            line = {'booked':'Booked','cancel':'Cancelled','change':'Trip changed','message':'New message','upcoming':'Upcoming trip'}[kind]+' · '+car
            import hashlib
            identity = hashlib.sha256((title+header_date).encode()).hexdigest()[:24]
            threads.append({'id':'mail:'+identity,'name':first,'line':line,'when':at.isoformat(),
                            **({'tripId':trip_id[1]} if trip_id else {})})
    return {'trips':trips,'threads':threads}

def main():
    result = {'error':'Host mail could not be checked. Showing the last saved snapshot.'}
    try:
        messages = _messages(_access_token(), 'from:turo.com newer_than:160d -subject:code -subject:security')
        # _messages has a bounded 160-message reader. Never claim a complete browser refresh.
        result = collect(messages)
    except Exception:
        pass
    with open('/sync/turo-mail.json', 'w') as f:
        json.dump(result,f)
    print('Host mail read complete' if 'error' not in result else 'Host mail unavailable; snapshot retained')
if __name__ == '__main__':
    main()
