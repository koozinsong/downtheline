// Down the Line — Google Apps Script Backend
// 이 코드를 Google Apps Script에 붙여넣고 웹앱으로 배포하세요

const SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();

function doGet(e) {
  const action = e.parameter.action;
  let result;

  if (action === 'getMatches')       result = getMatches(e.parameter.event);
  else if (action === 'getRankings')  result = getRankings();
  else if (action === 'getPlayers')   result = getPlayers();
  else if (action === 'getEvents')    result = getEvents();
  else if (action === 'getSchedules') result = getSchedules();
  else if (action === 'getSchedule')  result = getSchedule(e.parameter.id);
  else result = { error: 'Unknown action' };

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const action = data.action;
  let result;

  if (action === 'saveMatch')          result = saveMatch(data);
  else if (action === 'updateMatch')    result = updateMatch(data);
  else if (action === 'savePlayer')     result = savePlayer(data);
  else if (action === 'deleteMatch')    result = deleteMatch(data.id);
  else if (action === 'saveSchedule')   result = saveSchedule(data);
  else if (action === 'deleteSchedule') result = deleteSchedule(data.id);
  else result = { error: 'Unknown action' };

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── 시트 초기화 ──
function initSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // matches 시트
  let matches = ss.getSheetByName('matches');
  if (!matches) {
    matches = ss.insertSheet('matches');
    matches.appendRow(['id','date','event','team1_p1','team1_p2','team2_p1','team2_p2','score1','score2','mvp','notes','created_at']);
    matches.getRange(1,1,1,12).setFontWeight('bold').setBackground('#2c4a35').setFontColor('#ffffff');
  }

  // players 시트
  let players = ss.getSheetByName('players');
  if (!players) {
    players = ss.insertSheet('players');
    players.appendRow(['id','name','gender','joined_at']);
    players.getRange(1,1,1,4).setFontWeight('bold').setBackground('#2c4a35').setFontColor('#ffffff');
    // 기본 멤버
    const defaultPlayers = [
      ['p1','여1','female'],['p2','여2','female'],['p3','여3','female'],
      ['p4','남1','male'],['p5','남2','male'],['p6','남3','male'],['p7','남4','male']
    ];
    defaultPlayers.forEach(p => players.appendRow([p[0], p[1], p[2], new Date().toISOString()]));
  }

  // events 시트
  let events = ss.getSheetByName('events');
  if (!events) {
    events = ss.insertSheet('events');
    events.appendRow(['id','name','date','venue','status']);
    events.getRange(1,1,1,5).setFontWeight('bold').setBackground('#2c4a35').setFontColor('#ffffff');
    events.appendRow(['e1','아난티의 봄','2025-04-12','아난티 가평','upcoming']);
    events.appendRow(['e2','정기 매치','2025-04-06','세곡 테니스코트','upcoming']);
  }

  return { success: true, message: '시트 초기화 완료' };
}

// ── 경기 결과 저장 ──
function saveMatch(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('matches');
  if (!sheet) return { error: '시트 없음. initSheets() 먼저 실행하세요.' };

  const id = 'm_' + Date.now();
  sheet.appendRow([
    id,
    data.date,
    data.event,
    data.team1_p1,
    data.team1_p2,
    data.team2_p1,
    data.team2_p2,
    data.score1,
    data.score2,
    data.mvp || '',
    data.notes || '',
    new Date().toISOString()
  ]);

  // 랭킹 자동 업데이트
  updateRankings();

  return { success: true, id };
}

// ── 경기 결과 수정 ──
function updateMatch(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('matches');
  if (!sheet) return { error: '시트 없음' };

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === data.id) {
      sheet.getRange(i + 1, 1, 1, 12).setValues([[
        data.id,
        data.date,
        data.event,
        data.team1_p1,
        data.team1_p2,
        data.team2_p1,
        data.team2_p2,
        data.score1,
        data.score2,
        data.mvp || '',
        data.notes || '',
        rows[i][11] // keep original created_at
      ]]);
      updateRankings();
      return { success: true, id: data.id };
    }
  }
  return { error: '경기를 찾을 수 없습니다.' };
}


function getMatches(eventFilter) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('matches');
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rows = data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  }).filter(r => r.id);

  if (eventFilter) return rows.filter(r => r.event === eventFilter);
  return rows;
}

// ── 선수 목록 ──
function getPlayers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('players');
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  }).filter(r => r.id);
}

function savePlayer(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('players');
  const id = 'p_' + Date.now();
  sheet.appendRow([id, data.name, data.gender, new Date().toISOString()]);
  return { success: true, id };
}

// ── 이벤트 목록 ──
function getEvents() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('events');
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  }).filter(r => r.id);
}

function deleteMatch(id) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('matches');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      sheet.deleteRow(i + 1);
      updateRankings();
      return { success: true };
    }
  }
  return { error: '경기를 찾을 수 없습니다.' };
}

// ── 랭킹 자동 계산 ──
function updateRankings() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const matchSheet = ss.getSheetByName('matches');
  const playerSheet = ss.getSheetByName('players');

  if (!matchSheet || !playerSheet) return;

  const matches = getMatches();
  const players = getPlayers();

  const stats = {};
  players.forEach(p => {
    stats[p.name] = {
      name: p.name, gender: p.gender,
      played: 0, wins: 0, losses: 0,
      mvp: 0, points: 0
    };
  });

  matches.forEach(m => {
    const t1 = [m.team1_p1, m.team1_p2];
    const t2 = [m.team2_p1, m.team2_p2];
    const s1 = parseInt(m.score1) || 0;
    const s2 = parseInt(m.score2) || 0;
    const t1win = s1 > s2;

    [...t1, ...t2].forEach(name => {
      if (!stats[name]) stats[name] = { name, gender:'', played:0, wins:0, losses:0, mvp:0, points:0 };
      stats[name].played++;
    });
    t1.forEach(name => { if (stats[name]) { t1win ? stats[name].wins++ : stats[name].losses++; } });
    t2.forEach(name => { if (stats[name]) { t1win ? stats[name].losses++ : stats[name].wins++; } });

    if (m.mvp && stats[m.mvp]) stats[m.mvp].mvp++;
  });

  // 점수 계산: 승 3점 + MVP 1점
  Object.values(stats).forEach(s => {
    s.points = s.wins * 3 + s.mvp;
    s.winrate = s.played > 0 ? Math.round(s.wins / s.played * 100) : 0;
  });

  // rankings 시트 업데이트
  let rankSheet = ss.getSheetByName('rankings');
  if (!rankSheet) rankSheet = ss.insertSheet('rankings');
  rankSheet.clearContents();
  rankSheet.appendRow(['rank','name','gender','played','wins','losses','winrate','mvp','points']);
  rankSheet.getRange(1,1,1,9).setFontWeight('bold').setBackground('#2c4a35').setFontColor('#ffffff');

  const sorted = Object.values(stats).sort((a,b) => b.points - a.points || b.winrate - a.winrate);
  sorted.forEach((s, i) => {
    rankSheet.appendRow([i+1, s.name, s.gender, s.played, s.wins, s.losses, s.winrate+'%', s.mvp, s.points]);
  });
}

function getRankings() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('rankings');
  if (!sheet) {
    updateRankings();
    return getRankings();
  }

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

// ── 일정 저장 ──
function saveSchedule(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('schedules');
  if (!sheet) {
    sheet = ss.insertSheet('schedules');
    sheet.appendRow(['id','name','event','date','rounds','formats','schedule_json','created_at']);
    sheet.getRange(1,1,1,8).setFontWeight('bold').setBackground('#2c4a35').setFontColor('#ffffff');
  }
  const id = 'sch_' + Date.now();
  sheet.appendRow([
    id,
    data.name || '시합 일정',
    data.event || '',
    data.date || '',
    data.rounds || 0,
    (data.formats || []).join(','),
    JSON.stringify(data.schedule),
    new Date().toISOString()
  ]);
  return { success: true, id };
}

// ── 일정 목록 불러오기 ──
function getSchedules() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('schedules');
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  }).filter(r => r.id);
}

// ── 특정 일정 불러오기 ──
function getSchedule(id) {
  const schedules = getSchedules();
  const s = schedules.find(x => x.id === id);
  if (!s) return { error: '일정을 찾을 수 없습니다.' };
  s.schedule = JSON.parse(s.schedule_json);
  return s;
}

// ── 일정 삭제 ──
function deleteSchedule(id) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('schedules');
  if (!sheet) return { error: '시트 없음' };
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { error: '일정을 찾을 수 없습니다.' };
}
