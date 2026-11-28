import test from "node:test";
import assert from "node:assert/strict";
import { parseClanChatCommand } from "../chat-command-parser.js";

const bosses = [
  { id: "gast", name: "가스트", aliases: ["가스트"] },
  { id: "drake", name: "갈증의 드레이크", aliases: ["갈증", "갈드"] },
  { id: "drake1", name: "드레이크1", aliases: ["드1", "1"] },
  { id: "drake2", name: "드레이크2", aliases: ["드2", "2"] },
  { id: "inactive", name: "비활성보스", aliases: ["비활성"], is_active: false }
];

test("컷 명령어는 정식 보스명으로 자동 매칭한다", () => {
  assert.deepEqual(parseClanChatCommand("컷 가스트 20:35", bosses), {
    ok: true, action: "cut", bossId: "gast", bossName: "가스트",
    matchedText: "가스트", time: "20:35"
  });
});

test("취소 명령어는 별칭으로 매칭한다", () => {
  const result = parseClanChatCommand("취소 갈드 21:10", bosses);
  assert.equal(result.ok, true);
  assert.equal(result.action, "cancel");
  assert.equal(result.bossId, "drake");
  assert.equal(result.bossName, "갈증의 드레이크");
  assert.equal(result.time, "21:10");
});

test("보스 이름의 띄어쓰기 차이는 허용한다", () => {
  const result = parseClanChatCommand("컷 갈증의드레이크 21:10", bosses);
  assert.equal(result.ok, true);
  assert.equal(result.bossId, "drake");
});

test("일반 채팅은 명령어로 처리하지 않는다", () => {
  assert.equal(parseClanChatCommand("가스트 잡았습니다 20:35", bosses).reason, "not_command");
});

test("잘못된 시각은 거부한다", () => {
  assert.equal(parseClanChatCommand("컷 가스트 24:00", bosses).reason, "invalid_time");
  assert.equal(parseClanChatCommand("컷 가스트 20:60", bosses).reason, "invalid_time");
});

test("등록되지 않은 보스는 거부한다", () => {
  assert.equal(parseClanChatCommand("컷 없는보스 20:35", bosses).reason, "unknown_boss");
});

test("서로 다른 보스에 같은 별칭이 있으면 모호한 명령으로 거부한다", () => {
  const collision = [
    { id: "a", name: "보스A", aliases: ["공통"] },
    { id: "b", name: "보스B", aliases: ["공통"] }
  ];
  assert.equal(parseClanChatCommand("컷 공통 20:35", collision).reason, "ambiguous_boss");
});

test("비활성 보스는 매칭하지 않는다", () => {
  assert.equal(parseClanChatCommand("컷 비활성 20:35", bosses).reason, "unknown_boss");
});
