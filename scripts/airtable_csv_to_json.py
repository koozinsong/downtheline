#!/usr/bin/env python3
"""Airtable CSV 내보내기 → data/<Table>.json 변환 (git 백엔드 마이그레이션용)

사용법:
  python3 scripts/airtable_csv_to_json.py <입력폴더> <출력폴더>
  입력폴더에 Players.csv, Events.csv, Matches.csv, Schedules.csv, Booking.csv 를 둔다.
  (Airtable 각 테이블 → ⋯ 메뉴 → Download CSV)

변환 규칙:
  - 레코드 ID: Players는 기존 Airtable ID 유지(예약 Who 링크 보존),
    Schedules의 '시합 일정 2026-09-27'도 기존 ID 유지(Matches.schedule_id 참조 보존),
    나머지는 새로 생성
  - Booking.Who: 이름 목록 → Players 레코드 ID 배열
  - score1/score2 → int, NTRP → float, 빈 칸은 필드 생략
"""
import csv, json, random, string, sys, os
from datetime import datetime, timezone

# 기존 레코드 ID 보존 매핑 (2026-09 기준)
PLAYER_IDS = {
    "6근이": "rec5xAS6fCopQwo3L",
    "5른팔": "recCToq0CFOCOrod8",
    "Young": "recHfSsNR5a1hQ4lg",
    "9단주": "recfeE12tEKebhm9Z",
    "2쁜이": "recmSC0tsYgHupruC",
    "0국진": "recvakSqNuc0FaQpG",
}
SCHEDULE_IDS = {("시합 일정 2026-09-27", "2026-09-27"): "recSiZbCaZCb5Tzto"}

INT_FIELDS = {"score1", "score2"}
FLOAT_FIELDS = {"NTRP"}
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

def gen_id():
    return "rec" + "".join(random.choices(string.ascii_letters + string.digits, k=14))

def convert_value(key, val):
    v = val.strip()
    if v == "":
        return None
    if key in INT_FIELDS:
        try: return int(float(v))
        except ValueError: return v
    if key in FLOAT_FIELDS:
        try: return float(v)
        except ValueError: return v
    return v

def record_id_for(table, fields):
    if table == "Players":
        rid = PLAYER_IDS.get(fields.get("Name", ""))
        if rid: return rid
    if table == "Schedules":
        rid = SCHEDULE_IDS.get((fields.get("name", ""), fields.get("date", "")))
        if rid: return rid
    return gen_id()

def convert_table(table, path):
    records = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            fields = {}
            for k, v in row.items():
                if k is None or v is None:
                    continue
                k = k.strip()
                if not k or k == "Booking":  # Players의 역링크 컬럼은 제외
                    continue
                if table == "Booking" and k == "Who":
                    names = [n.strip() for n in v.split(",") if n.strip()]
                    ids = [PLAYER_IDS[n] for n in names if n in PLAYER_IDS]
                    unknown = [n for n in names if n not in PLAYER_IDS]
                    if unknown:
                        print(f"  ⚠ Booking.Who 미매칭 이름(생략): {unknown}")
                    if ids:
                        fields["Who"] = ids
                    continue
                cv = convert_value(k, v)
                if cv is not None:
                    fields[k] = cv
            if not fields:
                continue
            records.append({"id": record_id_for(table, fields), "createdTime": NOW, "fields": fields})
    return {"records": records}

def main():
    if len(sys.argv) != 3:
        print(__doc__); sys.exit(1)
    src, dst = sys.argv[1], sys.argv[2]
    os.makedirs(dst, exist_ok=True)
    for table in ["Players", "Events", "Matches", "Schedules", "Booking"]:
        path = os.path.join(src, f"{table}.csv")
        if not os.path.exists(path):
            print(f"— {table}.csv 없음, 빈 테이블 생성")
            data = {"records": []}
        else:
            data = convert_table(table, path)
            print(f"✓ {table}: {len(data['records'])}건")
        with open(os.path.join(dst, f"{table}.json"), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)

if __name__ == "__main__":
    main()
