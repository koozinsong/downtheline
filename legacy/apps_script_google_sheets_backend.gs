// Down the Line — Google Apps Script Backend
// 1. 이 코드 전체를 Google Apps Script에 붙여넣으세요
// 2. initSheets() 실행
// 3. 배포 → 새 배포 → 웹앱 → 모든 사용자 → 배포

function doGet(e) {
  const action = e.parameter.action;
  let result;
  try {
    if      (action === 'getPlayers')   result = getPlayers();
    else if (action === 'getEvents')    result = getEvents();
    else if (action === 'getMatches')   result = getMatches(e.parameter.event);
    else if (action === 'getRankings')  result = getRankings();
    else if (action === 'getSchedules') result = getSchedules();
    else if (action === 'getSchedule')  result = getSchedule(e.parameter.id);
    else result = { error: 'Unknown action: ' + action };
  } catch(err) { result = { error: err.toString() }; }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let data, result;
  try {
    data = JSON.parse(e.postData.contents);
    const action = data.action;
    if      (action === 'saveMatch')      result = saveMatch(data);
    else if (action === 'updateMatch')    result = updateMatch(data);
    else if (action === 'deleteMatch')    result = deleteMatch(data.id);
    else if (action === 'savePlayer')     result = savePlayer(data);
    else if (action === 'saveSchedule')   result = saveSchedule(data);
    else if (action === 'deleteSchedule') result = deleteSchedule(data.id);
    else if (action === 'clearAllMatches') result = clearAllMatches();
    else if (action === 'clearMatchesBySchedule') result = clearMatchesBySchedule(data.schedule_id);
    else if (action === 'saveEvent')     result = saveEvent(data);
    else if (action === 'updateEvent')   result = updateEvent(data);
    else if (action === 'deleteEvent')   result = deleteEvent(data.id);
    else result = { error: 'Unknown action: ' + data.action };
  } catch(err) { result = { error: err.toString() }; }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

// ── 일정별 경기 기록 초기화 ──
function clearMatchesBySchedule(scheduleId) {
  if (!scheduleId) return { error: 'schedule_id 필요' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('matches');
  if (!sheet || sheet.getLastRow() < 2) return { success: true, deleted: 0 };
  const rows = sheet.getDataRange().getValues();
  const sidIdx = rows[0].indexOf('schedule_id');
  if (sidIdx === -1) return { error: 'schedule_id 컬럼 없음' };
  let deleted = 0;
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][sidIdx]) === String(scheduleId)) {
      sheet.deleteRow(i + 1);
      deleted++;
    }
  }
  if (deleted > 0) updateRankings();
  return { success: true, deleted };
}

// ── 전체 경기 기록 초기화 (테스트 데이터 정리용) ──
function clearAllMatches() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('matches');
  if (!sheet || sheet.getLastRow() < 2) return { success: true, deleted: 0 };
  const lastRow = sheet.getLastRow();
  sheet.deleteRows(2, lastRow - 1);
  updateRankings();
  return { success: true, deleted: lastRow - 1 };
}
function initSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  function makeSheet(name, headers) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.appendRow(headers);
      sheet.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#2c4a35').setFontColor('#ffffff');
    }
    return sheet;
  }

  makeSheet('matches',   ['id','date','event','team1_p1','team1_p2','team2_p1','team2_p2','score1','score2','mvp','notes','created_at','schedule_id']);
  makeSheet('events',    ['id','name','date','venue','status']);
  makeSheet('rankings',  ['rank','name','gender','played','wins','losses','winrate','mvp','points']);
  makeSheet('schedules', ['id','name','event','date','rounds','formats','schedule_json','created_at']);

  let players = ss.getSheetByName('players');
  if (!players) {
    players = ss.insertSheet('players');
    players.appendRow(['id','name','gender','joined_at']);
    players.getRange(1,1,1,4).setFontWeight('bold').setBackground('#2c4a35').setFontColor('#ffffff');
    [['p1','여1','female'],['p2','여2','female'],['p3','여3','female'],
     ['p4','남1','male'],  ['p5','남2','male'],  ['p6','남3','male'],['p7','남4','male']
    ].forEach(p => players.appendRow([p[0],p[1],p[2],new Date().toISOString()]));
  }

  const evSheet = ss.getSheetByName('events');
  if (evSheet.getLastRow() < 2) {
    evSheet.appendRow(['e1','아난티의 봄','2025-04-12','아난티 가평','upcoming']);
    evSheet.appendRow(['e2','정기 매치','2025-04-06','세곡 테니스코트','upcoming']);
  }

  return { success: true, message: '시트 초기화 완료' };
}

// ── 공통 유틸 ──
function sheetToObjects(sheetName) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      if (h === 'date' && row[i] instanceof Date) {
        obj[h] = Utilities.formatDate(row[i], 'Asia/Seoul', 'yyyy-MM-dd');
      } else {
        obj[h] = row[i];
      }
    });
    return obj;
  }).filter(r => r.id);
}

// ── 선수 ──
function getPlayers() { return sheetToObjects('players'); }

function savePlayer(data) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('players');
  if (!sheet) return { error: '시트 없음' };
  const id = 'p_' + Date.now();
  sheet.appendRow([id, data.name, data.gender, new Date().toISOString()]);
  return { success: true, id };
}

// ── 이벤트 ──
function getEvents() { return sheetToObjects('events'); }

function saveEvent(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('events');
  if (!sheet) return { error: '시트 없음' };
  const id = 'ev_' + Date.now();
  sheet.appendRow([id, data.name, data.date, data.venue||'', data.status||'upcoming']);
  return { success: true, id };
}

function updateEvent(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('events');
  if (!sheet) return { error: '시트 없음' };
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.id)) {
      sheet.getRange(i+1,1,1,5).setValues([[
        data.id, data.name, data.date, data.venue||'', data.status||rows[i][4]
      ]]);
      return { success: true, id: data.id };
    }
  }
  return { error: '이벤트를 찾을 수 없습니다' };
}

function deleteEvent(id) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('events');
  if (!sheet) return { error: '시트 없음' };
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      sheet.deleteRow(i+1);
      return { success: true };
    }
  }
  return { error: '이벤트를 찾을 수 없습니다' };
}

// ── 경기 결과 ──
function getMatches(eventFilter) {
  const rows = sheetToObjects('matches');
  return eventFilter ? rows.filter(r => r.event === eventFilter) : rows;
}

function saveMatch(data) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('matches');
  if (!sheet) return { error: '시트 없음. initSheets() 실행 필요' };
  const sv1 = parseInt(data.score1), sv2 = parseInt(data.score2);
  if (isNaN(sv1) || isNaN(sv2) || sv1 < 0 || sv1 > 6 || sv2 < 0 || sv2 > 6) return { error: '스코어는 0~6 범위여야 합니다' };
  const pls = [data.team1_p1, data.team1_p2, data.team2_p1, data.team2_p2];
  if (new Set(pls).size !== 4) return { error: '선수가 중복되었습니다' };
  const id = 'm_' + Date.now();
  sheet.appendRow([id, data.date, data.event,
    data.team1_p1, data.team1_p2, data.team2_p1, data.team2_p2,
    data.score1, data.score2, data.mvp||'', data.notes||'',
    new Date().toISOString(), data.schedule_id||''
  ]);
  updateRankings();
  return { success: true, id };
}

function updateMatch(data) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('matches');
  if (!sheet) return { error: '시트 없음' };
  const sv1 = parseInt(data.score1), sv2 = parseInt(data.score2);
  if (isNaN(sv1) || isNaN(sv2) || sv1 < 0 || sv1 > 6 || sv2 < 0 || sv2 > 6) return { error: '스코어는 0~6 범위여야 합니다' };
  const pls = [data.team1_p1, data.team1_p2, data.team2_p1, data.team2_p2];
  if (new Set(pls).size !== 4) return { error: '선수가 중복되었습니다' };
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === data.id) {
      sheet.getRange(i+1,1,1,13).setValues([[
        data.id, data.date, data.event,
        data.team1_p1, data.team1_p2, data.team2_p1, data.team2_p2,
        data.score1, data.score2, data.mvp||'', data.notes||'', rows[i][11],
        data.schedule_id || rows[i][12] || ''
      ]]);
      updateRankings();
      return { success: true, id: data.id };
    }
  }
  return { error: '경기를 찾을 수 없습니다' };
}

function deleteMatch(id) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('matches');
  if (!sheet) return { error: '시트 없음' };
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      sheet.deleteRow(i+1);
      updateRankings();
      return { success: true };
    }
  }
  return { error: '경기를 찾을 수 없습니다' };
}

// ── 랭킹 ──
function updateRankings() {
  const ss          = SpreadsheetApp.getActiveSpreadsheet();
  const matchSheet  = ss.getSheetByName('matches');
  const playerSheet = ss.getSheetByName('players');
  if (!matchSheet || !playerSheet) return;

  const matches = getMatches();
  const players = getPlayers();
  const stats   = {};

  players.forEach(p => {
    stats[p.name] = { name:p.name, gender:p.gender, played:0, wins:0, losses:0, mvp:0, gf:0, ga:0 };
  });

  matches.forEach(m => {
    const t1 = [m.team1_p1, m.team1_p2];
    const t2 = [m.team2_p1, m.team2_p2];
    const s1 = parseInt(m.score1)||0, s2 = parseInt(m.score2)||0;
    const t1win = s1 > s2;

    [...t1,...t2].forEach(name => {
      if (!stats[name]) stats[name] = {name, gender:'', played:0, wins:0, losses:0, mvp:0, gf:0, ga:0};
      stats[name].played++;
    });
    t1.forEach(name => {
      if (!stats[name]) return;
      t1win ? stats[name].wins++ : stats[name].losses++;
      stats[name].gf += s1;
      stats[name].ga += s2;
    });
    t2.forEach(name => {
      if (!stats[name]) return;
      t1win ? stats[name].losses++ : stats[name].wins++;
      stats[name].gf += s2;
      stats[name].ga += s1;
    });
    if (m.mvp && stats[m.mvp]) stats[m.mvp].mvp++;
  });

  let rankSheet = ss.getSheetByName('rankings');
  if (!rankSheet) rankSheet = ss.insertSheet('rankings');
  rankSheet.clearContents();
  rankSheet.appendRow(['rank','name','gender','played','wins','losses','winrate','gf','ga','gd','mvp','points']);
  rankSheet.getRange(1,1,1,12).setFontWeight('bold').setBackground('#2c4a35').setFontColor('#ffffff');

  Object.values(stats).map(s => ({
    ...s,
    points:  s.wins*3 + s.mvp,
    winrate: s.played>0 ? Math.round(s.wins/s.played*100) : 0,
    gd:      s.gf - s.ga
  })).sort((a,b) =>
    b.points  - a.points  ||
    b.gd      - a.gd      ||
    b.gf      - a.gf
  ).forEach((s,i) => rankSheet.appendRow([
    i+1, s.name, s.gender, s.played,
    s.wins, s.losses, s.winrate+'%',
    s.gf, s.ga, s.gd, s.mvp, s.points
  ]));
}

function getRankings() {
  updateRankings();
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('rankings');
  if (!sheet || sheet.getLastRow() < 2) return [];
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  return data.slice(1).map(row => { const o={}; headers.forEach((h,i)=>o[h]=row[i]); return o; });
}

// ── 시합 일정 ──
function saveSchedule(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('schedules');
  if (!sheet) {
    sheet = ss.insertSheet('schedules');
    sheet.appendRow(['id','name','event','date','rounds','formats','schedule_json','created_at']);
    sheet.getRange(1,1,1,8).setFontWeight('bold').setBackground('#2c4a35').setFontColor('#ffffff');
    // date 컬럼 텍스트 형식 고정
    sheet.getRange('D:D').setNumberFormat('@STRING@');
  }
  const id = 'sch_' + Date.now();
  const dateStr = String(data.date || Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd'));
  const lastRow = sheet.getLastRow() + 1;
  // date 컬럼을 먼저 텍스트로 설정 후 값 입력
  sheet.getRange(lastRow, 4).setNumberFormat('@STRING@');
  sheet.getRange(lastRow, 1, 1, 8).setValues([[
    id,
    data.name   || '시합 일정',
    data.event  || '',
    dateStr,
    data.rounds || 0,
    (data.formats||[]).join(','),
    JSON.stringify(data.schedule),
    new Date().toISOString()
  ]]);
  return { success: true, id };
}

function getSchedules() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('schedules');
  if (!sheet || sheet.getLastRow() < 2) return [];
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      // 날짜 컬럼은 항상 yyyy-MM-dd 문자열로 반환
      if (h === 'date' && row[i] instanceof Date) {
        obj[h] = Utilities.formatDate(row[i], 'Asia/Seoul', 'yyyy-MM-dd');
      } else {
        obj[h] = row[i];
      }
    });
    return obj;
  }).filter(r => r.id);
}

function getSchedule(id) {
  const s = getSchedules().find(x => x.id === id);
  if (!s) return { error: '일정을 찾을 수 없습니다' };
  try { s.schedule = JSON.parse(s.schedule_json); } catch(e) { s.schedule = []; }
  return s;
}

function deleteSchedule(id) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('schedules');
  if (!sheet) return { error: '시트 없음' };

  const rows = sheet.getDataRange().getValues();
  let schedRow = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      schedRow = i + 1;
      break;
    }
  }
  if (schedRow === -1) return { error: '일정을 찾을 수 없습니다' };

  // schedule_id로 연결된 경기 기록 삭제
  // + 하위 호환: schedule_id 없는 이전 기록은 이벤트/날짜로 매칭
  const matchSheet = ss.getSheetByName('matches');
  if (matchSheet && matchSheet.getLastRow() > 1) {
    const matchRows = matchSheet.getDataRange().getValues();
    const headers   = matchRows[0];
    const sidIdx    = headers.indexOf('schedule_id');
    const evIdx     = headers.indexOf('event');
    const dtIdx     = headers.indexOf('date');

    // 삭제할 일정의 event/date 가져오기
    const schedRows = sheet.getDataRange().getValues();
    let schedEvent = '', schedDate = '';
    for (let i = 1; i < schedRows.length; i++) {
      if (String(schedRows[i][0]) === String(id)) {
        schedEvent = String(schedRows[i][2] || '').trim();
        const rd = schedRows[i][3];
        schedDate = rd instanceof Date
          ? Utilities.formatDate(rd, 'Asia/Seoul', 'yyyy-MM-dd')
          : String(rd || '').substring(0, 10);
        break;
      }
    }

    let deleted = 0;
    for (let i = matchRows.length - 1; i >= 1; i--) {
      const mSchedId = sidIdx >= 0 ? String(matchRows[i][sidIdx] || '') : '';
      const mEvent   = evIdx  >= 0 ? String(matchRows[i][evIdx]  || '').trim() : '';
      const rawMDate = dtIdx  >= 0 ? matchRows[i][dtIdx] : '';
      const mDate    = rawMDate instanceof Date
        ? Utilities.formatDate(rawMDate, 'Asia/Seoul', 'yyyy-MM-dd')
        : String(rawMDate || '').substring(0, 10);

      const byId    = mSchedId && mSchedId === String(id);
      const byEvent = !mSchedId && schedEvent && mEvent === schedEvent;
      const byDate  = !mSchedId && schedDate  && mDate  === schedDate;

      if (byId || byEvent || byDate) {
        matchSheet.deleteRow(i + 1);
        deleted++;
      }
    }
    if (deleted > 0) updateRankings();
  }

  sheet.deleteRow(schedRow);
  return { success: true };
}
