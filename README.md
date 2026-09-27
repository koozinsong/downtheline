# DTL 데이터 브랜치

이 브랜치는 사이트 배포(main)와 분리된 **데이터 전용 브랜치**입니다.
`data/*.json` 파일들이 클럽의 실데이터이며, Cloudflare Worker(dlt-api)가
GitHub Contents API로 읽고 씁니다 (Airtable 대체, 2026-09-27 마이그레이션).

- Players.json — 멤버 (레코드 ID는 예약 Who 링크가 참조하므로 변경 금지)
- Matches.json — 경기 기록
- Schedules.json — 확정된 시합 일정
- Booking.json — 코트 예약
- Events.json — 이벤트

수동으로 편집해도 되지만, 동시에 사이트에서 저장이 일어나면 충돌할 수 있으니
가급적 사이트 또는 관리 도구를 통해 수정하세요.
