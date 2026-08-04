# 보안 조치 안내 (2026-08-04)

## 무엇이 문제였나

쓰기 권한이 있는 Airtable Personal Access Token(`patzqAMF1KGaHm2dz.…c100`)이
`index.html`, `schedule.html`, `booking.html`, `ranking.html`, `results.html` 5개 파일에
평문으로 하드코딩된 채 공개 저장소(github.com/koozinsong/downtheline)에 커밋되어 있었다.
페이지 소스를 본 누구나 이 토큰으로 DTL 베이스의 예약/선수/경기 데이터를
읽고·수정하고·삭제할 수 있는 상태였다.

코드 수정만으로는 해결되지 않는다 — 토큰은 git 히스토리(커밋 `3d96314` 이후 전체)에 남아 있다.

## 사용자가 직접 해야 하는 것 (순서대로)

### 1. 기존 토큰 폐기 + 재발급 (필수, 최우선)

1. https://airtable.com/create/tokens 접속
2. 기존 토큰(`patzqAMF1KGaHm2dz…`) **Revoke**
3. 새 토큰 발급 — scope는 `data.records:read` + `data.records:write`,
   access는 DTL 베이스(`appDtlXaLReCaDeE6`) 하나로만 제한
4. 새 토큰은 **코드에 넣지 말고** 아래 프록시의 환경변수로만 사용

### 2. 프록시 배포 (5분)

[proxy/cloudflare-worker.js](proxy/cloudflare-worker.js) 파일 상단 주석의 절차대로
Cloudflare Worker를 배포하고, 새 토큰을 Worker의 Secret 환경변수로 등록한다.

배포 후 Worker URL을 `js/api.js`의 `AT_PROXY` 상수에 넣으면
전 페이지가 토큰 없이 프록시를 통해 동작한다.
(`AT_PROXY`가 비어 있는 동안은 기존 방식(직접 호출)으로 폴백하므로,
전환 전까지 사이트는 계속 동작한다.)

### 3. git 히스토리 정리 (토큰 revoke 후에는 선택)

토큰을 폐기하면 히스토리에 남은 옛 토큰은 무용지물이므로 보안상 필수는 아니다.
그래도 정리하려면 둘 중 하나:

- **간단**: GitHub 저장소를 Private으로 전환
- **완전 제거**: `git filter-repo --replace-text` 로 토큰 문자열을 히스토리에서 치환 후
  force push (모든 클론이 무효화되므로 주의)

## 코드에 반영된 것

- `proxy/cloudflare-worker.js` — 테이블 allowlist + CORS + 토큰 서버 보관 프록시
- `js/api.js` — Airtable 접근 단일화. `AT_PROXY` 설정 시 토큰 없이 동작
- `.gitignore` — `.claude/` 추가 (로컬 설정에 토큰이 포함되어 있었음)

## 남은 알려진 한계

- 프록시 전환 후에도 **인증(로그인)은 없다**. CORS로 다른 사이트에서의 호출은 막지만,
  주소를 아는 사람이 직접 API를 호출하는 것까지 막지는 못한다.
  클럽 내부용 도구 수준에서는 허용 가능한 위험이지만,
  필요해지면 프록시에 간단한 공유 비밀번호(헤더 검사)를 추가할 것.
