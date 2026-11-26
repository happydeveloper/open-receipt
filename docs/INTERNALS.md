# 안에서 일어나는 일

에이전트, 화면과 에이전트 사이의 통신(AG-UI), 기기 간 동기화, 서명 원장이 어떻게 동작하는지 적었습니다. 코드가 어디에 있는지는 [ARCHITECTURE.md](ARCHITECTURE.md)를 보세요.

## 에이전트가 하는 일

에이전트는 정해진 순서를 따르지 않고, 목표를 받아 도구를 스스로 골라 가며 끝날 때까지 반복합니다 (`lib/agent.ts`).

| 에이전트 | 목표 | 쓸 수 있는 도구 |
| --- | --- | --- |
| 지출 에이전트 | 지출 한 건의 증빙 묶음 완성 | `update_record` 기록 채우기, `lookup_history` 지난 기록 조회, `check_bundle` 묶음 점검, `ask_user` 사용자에게 묻기, `search_guidelines` 공개 지침 검색(Liner Search), `finish` 마무리 |
| 마감 점검 에이전트 | 제출 전 보완 요청과 브리핑 준비 | `list_records`, `inspect_record`, `search_guidelines`, `draft_request` 요청 문안 초안, `finish` |

안전장치:

- 승인·확정·송금·메시지 발송 도구는 없습니다. 상태는 사람의 확정·승인 클릭으로만 바뀝니다 (`lib/status.ts`).
- 사람이 직접 넣은 값은 에이전트가 덮어쓰지 못합니다.
- "확인할 자료"는 검색 결과에 실제로 있는 URL이 달린 항목만 남깁니다.
- "적법/위반" 같은 판정 표현은 걸러 "확인이 필요합니다"로 바꿉니다 (`lib/guard.ts`).
- 한 번 실행에 모델 호출 10회, 검색 3회, 질문 2회까지만 허용합니다. 필수 정보가 빈 채로 끝내려 하면 한 번 돌려보냅니다.

## AG-UI 프로토콜 연동

화면과 에이전트는 AG-UI 1.0 규격으로 통신합니다. 서버는 손으로 구현했고(`lib/agui-server.ts`), 화면은 공식 클라이언트 `@ag-ui/client`의 `HttpAgent`를 씁니다(`app/app/page.tsx`). 그래서 AG-UI를 지원하는 다른 프런트엔드에서도 이 에이전트를 그대로 부를 수 있습니다.

엔드포인트 (POST, 본문은 `RunAgentInput` JSON, 응답은 `text/event-stream`):

| 주소 | 에이전트 | `state`에 넣는 것 |
| --- | --- | --- |
| `/api/agent/expense` | 지출 에이전트 | `record`, `locked`, `evidence`, `history`. 단체 이름·지원기관·현재 사업은 `context`로 전달 |
| `/api/agent/close` | 마감 점검 에이전트 | `project`, `records` |
| `/api/agent/group` | 묶음 에이전트 | `documents` (서류별 날짜, 금액, 가맹점, 항목, 결제 방식, 서류 종류). 결과는 `groups` |

한 번의 실행에서 오가는 이벤트:

```
RUN_STARTED (protocolVersion "1.0")
STATE_SNAPSHOT                      기준 상태
  TOOL_CALL_START / ARGS / END      에이전트가 고른 도구
  TOOL_CALL_RESULT                  서버가 실행한 도구의 결과
  ACTIVITY_SNAPSHOT                 화면에 보여 줄 진행 단계 ("기록을 채웠습니다")
  STATE_DELTA                       기록 변경 (JSON Patch)
TEXT_MESSAGE_START / CONTENT / END  요약 또는 브리핑
RUN_FINISHED | RUN_ERROR
```

사용자에게 묻기는 AG-UI의 프런트엔드 도구 방식으로 처리합니다.

1. 화면이 `tools`에 `ask_user` 도구를 실어 보냅니다.
2. 에이전트가 `ask_user`를 호출하면 서버는 답하지 않고 `RUN_FINISHED`의 `outcome.pendingToolCallIds`에 그 호출 id를 담아 실행을 끝냅니다.
3. 화면이 질문 카드를 띄우고, 답을 `role: "tool"` 메시지로 `messages`에 붙여 다음 실행을 시작합니다.

서버는 실행 사이에 아무것도 저장하지 않습니다. 대화는 `messages`에, 기록과 검색 출처는 `state`에 실려 옵니다. 영수증 이미지는 user 메시지의 `image` 파트(base64)로 보냅니다. 실행 전 오류(형식 오류, 허용되지 않는 이미지)는 HTTP 400으로, 실행 중 오류는 스트림 안의 `RUN_ERROR`로 알립니다.

다른 출처의 브라우저에서도 부를 수 있도록 세 엔드포인트의 CORS를 열어 두었습니다. `HttpAgent` 예제, 상태 구조, 질문 받고 답하는 방법은 앱의 [개발자 안내](https://open-receipt-six.vercel.app/developers) 페이지(`app/developers/page.tsx`)에 있습니다. 인증이 없는 시연용 엔드포인트이므로 실서비스에 붙이려면 자신의 Liner 키로 직접 배포하세요. 한 주소에서 10분에 80번, 하루 400번을 넘거나 전체 호출이 하루 3,000번을 넘으면 `429`와 `Retry-After`로 거절합니다(`lib/rate-limit.ts`). 횟수를 서버 인스턴스 메모리에 두는 안전장치여서 정확한 상한은 아닙니다.

직접 호출 예:

```bash
curl -N https://open-receipt-six.vercel.app/api/agent/expense \
  -H "Content-Type: application/json" -H "Accept: text/event-stream" \
  -d '{"threadId":"t1","runId":"r1","messages":[{"id":"u1","role":"user","content":"11월 18일 워크숍 다과 26,400원 개인 카드로 결제"}],"tools":[],"context":[],"state":{"record":{},"evidence":{"kind":"none"}}}'
```

## 단체 공간 동기화 구조

| 구성 | 위치 | 하는 일 |
| --- | --- | --- |
| 암호화 | `lib/sync-crypto.ts` | 단체 공간 주소·열쇠 생성, AES-GCM 암복호화, 쓰기 증표 |
| 합치기 | `lib/sync-merge.ts` | 같은 기록을 칸 단위로 합치기(서로 다른 칸을 고치면 둘 다 남음), 삭제 기록(tombstone), 이미지 분리 |
| 동기화 | `lib/sync-client.ts` | 받기 → 합치기 → 올리기. 다른 기기가 먼저 올렸으면 다시 받아 재시도 |
| 서버 | `lib/sync-store.ts`, `app/api/sync/` | 암호문 보관, 버전 충돌 감지(409), 열쇠 가진 사람만 쓰기 |
| 원본 보관 | `lib/originals.ts` | 원본 영수증을 기기의 IndexedDB에 보관 |
| 후원자용 보기 | `lib/sponsor-view.ts`, `app/v/page.tsx` | 결산보고서와 가린 영수증을 후원자 열쇠로 암호화해 게시, 읽기 전용 화면 |

서버는 단체 공간 주소와 암호문, 쓰기 증표의 해시만 압니다.

## 서명 원장

기록이 바뀌지 않았음을 여러 기기가 서로 확인하기 위한 구조입니다(`lib/ledger.ts`). 블록체인의 해시 사슬과 전자서명을 쓰고, 채굴·합의 알고리즘·코인은 없습니다.

1. **기기 열쇠**: 기기마다 ECDSA P-256 열쇠 쌍을 만듭니다. 열쇠 id는 공개 열쇠의 해시이고, 비밀 열쇠는 그 기기의 브라우저에만 있습니다.
2. **서명한 줄**: 기록을 올리거나 고치거나 승인하거나 지우면 그 기기의 원장에 한 줄을 덧붙입니다. 줄에는 기록 내용의 해시, 앞줄의 해시, 그때 밝힌 이름과 역할이 들어가고 기기 열쇠로 서명합니다.
3. **기기별 원장**: 원장이 기기마다 따로 있어서 여러 기기가 동시에 써도 충돌하지 않습니다.
4. **서로 가진 사본**: 단체 공간 문서에 모든 원장이 함께 실립니다. 동기화할 때 받은 원장의 서명과 사슬을 검증하고, 실패한 원장은 받지 않습니다. 같은 기기의 원장은 한쪽이 다른 쪽의 앞부분일 때만 긴 쪽을 받으므로, 누가 서버 사본을 잘라 내도 다른 기기의 사본이 되살립니다.
5. **승인 검증**: 승인자 역할을 밝힌 기기가, 그 내용을 올린 기기와 다른 열쇠로 서명한 승인만 인정합니다. 아니면 기록 상세에 "승인 서명을 확인할 수 없습니다"가 뜹니다.
6. **지문**: 결산보고서, 공유 링크, 후원자용 보기에 "보고서 지문"(그 사업 기록 전체의 해시)과 "원장 지문"이 함께 나갑니다. 후원자용 보기는 지난번에 본 지문을 브라우저에 기억해 두고, 달라졌으면 알려 줍니다.

한계: 이름과 역할은 각 기기가 스스로 밝힌 값이라, 한 사람이 기기 두 대로 등록자와 승인자를 겸하는 것은 막지 못합니다(설정의 기기 목록에서 드러나기는 합니다). 영수증 사진은 해시만 줄에 남기고 검증 화면은 아직 없습니다. 구성원 전원이 원장을 통째로 새로 만드는 것은 외부에 준 지문과 견줘야만 드러납니다. 원장은 기록이 바뀌지 않았음을 보여 줄 뿐, 내용이 사실인지는 증명하지 않습니다.

## 디자인 시스템

화면은 Astryx 컴포넌트(Button, TextInput, TextArea, Selector, SegmentedControl, Card, Banner, List, Table, Token, EmptyState 등)와 neutral 테마로 구성했습니다. 설정은 `app/globals.css`(스타일 4개 import)와 `app/providers.tsx`(테마 공급자)에 있습니다. Astryx에 없는 부품 세 가지(앱 틀, 영수증 가림 영역, 에이전트 진행 로그)만 직접 만들었고 색과 간격은 테마 토큰을 씁니다. 설정 점검은 `npx astryx doctor --built .`로 합니다.

공식 CLI는 `@astryxdesign/cli`입니다. 이름이 비슷한 `astryx` 패키지는 무관한 것이니 `npx astryx`는 이 저장소처럼 CLI가 설치된 상태에서만 쓰세요.

## 소개 페이지와 출시 알림

첫 화면(`/`, `app/page.tsx`)은 취지와 사용법을 실제 앱 화면으로 설명하는 소개 페이지입니다. 화면 사진은 `SHOTS_LANDING=1 npx playwright test e2e/landing-shots.spec.ts`로 실제 앱을 브라우저에서 캡처해 `public/landing/`에 만듭니다.

페이지 끝에서 정식 출시 알림을 신청받습니다(`lib/waitlist.ts`, `app/api/waitlist/`). 이메일은 동의를 받은 뒤 비공개 저장소에 저장하고, 출시 안내에만 씁니다. 같은 페이지에서 신청을 취소하면 바로 삭제합니다.
