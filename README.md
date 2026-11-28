# 열린영수증

회계 담당자가 따로 없는 작은 단체·동아리·모임을 위한 정산 도구입니다. 영수증 사진을 올리면 AI 에이전트가 지출 기록을 채우고, 모르는 것만 되묻고, 승인과 결산보고서, 후원자 공개까지 이어 줍니다. [라이너 .EXE-THON](https://contests.liner.com/hackathon/exe-thon-2611/) 출품작이며 지금은 베타입니다.

| | |
| --- | --- |
| 써 보기 | https://open-receipt-six.vercel.app/app (설치·가입 없음. **데모 데이터 불러오기**를 누르면 가상 자료로 둘러볼 수 있습니다) |
| 소개 | https://open-receipt-six.vercel.app |
| 사용 안내 | https://open-receipt-six.vercel.app/guide (등록자·승인자·후원자가 화면을 보고 따라 하는 방법) |
| 시연 영상 | https://youtu.be/fnz0AhQ4IRE (3분 19초) |

## 왜 만들었나

작은 단체에서는 여러 사람이 각자 돈을 먼저 쓰고, 영수증은 종이와 메신저 사진과 이체 내역으로 흩어집니다. 누가 무엇을 위해 썼는지는 그때만 알고, 마감 때 다시 물어야 합니다. 열린영수증은 지출이 생긴 그 자리에서 정산할 수 있는 기록을 완성해 둡니다.

- **올리면 채워집니다.** 영수증 사진이나 PDF에서 날짜, 금액, 가맹점, 항목을 읽고, 지난 기록을 보고 사업과 예산 항목을 맞춥니다. 알 수 없는 것(목적, 결제자, 환급 여부)만 묻습니다.
- **서류를 한 거래로 묶습니다.** 카드영수증, 거래명세서, 주문 화면 캡처가 따로 올라와도 같은 거래를 찾아 합치자고 제안합니다.
- **여럿이 모으고 승인합니다.** 각자 기기에서 올리면 암호화되어 모이고, 승인자가 승인하거나 사유를 적어 되돌립니다. 누가 무엇을 했는지는 이력과 서명으로 남습니다.
- **마감과 보고를 돕습니다.** 마감 점검 에이전트가 빠진 증빙을 찾아 요청 문안을 써 두고, 사업별 결산보고서를 만듭니다. 결산이 끝난 사업은 마감해 기록을 잠급니다. 후원자에게는 가린 영수증까지 링크로 보여 줄 수 있습니다.
- **결정은 사람이 합니다.** 에이전트는 확정, 승인, 발송, 송금을 하지 않고, 지출이 규정에 맞는지 판정하지도 않습니다.

## 시연 영상

[![열린영수증 시연 영상](https://img.youtube.com/vi/fnz0AhQ4IRE/hqdefault.jpg)](https://youtu.be/fnz0AhQ4IRE)

그림을 누르면 유튜브에서 열립니다: https://youtu.be/fnz0AhQ4IRE

같은 영상을 [소개 페이지](https://open-receipt-six.vercel.app/#demo)에서도 볼 수 있습니다. 만드는 방법은 `video/PLAN.md`에 있습니다.

## 실행 방법

Node.js 22 이상이 필요합니다.

```bash
git clone https://github.com/happydeveloper/open-receipt.git
cd open-receipt
npm install
cp .env.example .env.local   # LINER_API_KEY 입력 (https://platform.liner.com/keys)
npm run dev                  # http://localhost:3000
```

브라우저에서 http://localhost:3000 을 열면 소개 페이지가, http://localhost:3000/app 을 열면 앱이 나옵니다. 앱에서 **데모 데이터 불러오기**를 누르면 가상 단체와 가상 영수증으로 바로 써 볼 수 있습니다.

API 키는 서버(`lib/liner.ts`)에서만 읽습니다. 키가 없어도 앱은 열리고 직접 입력으로 쓸 수 있습니다. 설치 없이 써 보려면 배포본(https://open-receipt-six.vercel.app/app)을 여세요.

| 환경 변수 | 필요 | 내용 |
| --- | --- | --- |
| `LINER_API_KEY` | 에이전트를 쓰려면 | Liner Platform API 키 |
| `LINER_MODEL` | 선택 | 모델 이름. 기본값 `liner-gpt-router` |
| `BLOB_READ_WRITE_TOKEN` | 배포 환경에서 단체 공간을 쓰려면 | Vercel Blob 저장소 토큰. Vercel에서 Blob 저장소를 연결하면 자동으로 들어갑니다. 로컬 개발에서는 없어도 되고 `.data/` 폴더에 저장합니다 |
| `NEXT_PUBLIC_SOURCE_URL` | 선택 | 소스 저장소 주소. 넣으면 소개 페이지에 "소스 코드 받기" 버튼이 나옵니다 |

### 직접 배포하기

Vercel에 올리는 경우: 저장소를 Vercel 프로젝트로 가져오고, 환경 변수에 `LINER_API_KEY`를 넣고, Storage에서 Blob 저장소(비공개)를 만들어 프로젝트에 연결합니다. 다른 곳에 올리려면 `lib/sync-store.ts`의 `SyncStore` 인터페이스를 그곳의 저장소로 구현하면 됩니다.

## Liner API를 사용한 기능

핵심 기능인 세 에이전트(지출, 마감 점검, 묶음)가 Liner Model API와 Liner Search API로 동작합니다. 호출은 모두 서버의 `lib/liner.ts`를 거칩니다.

| 기능 | 쓰는 API | 하는 일 | 코드 |
| --- | --- | --- | --- |
| 영수증 읽기 | Model API (이미지 입력) | 가린 영수증 사진에서 일자, 금액, 가맹점, 항목, 결제 방식을 읽어 기록을 채웁니다 | `lib/agent.ts`의 `update_record` |
| 지출 에이전트 | Model API (도구 호출) | 모델이 도구 여섯 개 가운데 다음에 쓸 것을 스스로 골라 가며 증빙 묶음을 완성합니다. 지난 기록을 참고해 사업과 예산 항목을 맞추고, 빠진 것을 점검하고, 알 수 없는 것만 사용자에게 묻습니다 | `lib/agent.ts`의 `runExpenseAgent` |
| 공개 지침 검색 | Search API | 지출 종류와 결제 방식에 맞는 공개 정산·증빙 지침을 검색합니다. 결과가 맞지 않으면 에이전트가 검색어를 바꿔 다시 찾습니다 (한 번 실행에 3번까지) | `lib/agent.ts`의 `search_guidelines` |
| 확인할 자료 | Model API + Search API | 검색 결과를 읽고 이 지출에서 챙길 자료를 출처 링크와 함께 정리합니다. 검색 결과에 실제로 있는 주소가 달린 항목만 남깁니다 | `lib/agent.ts`의 `validChecklist` |
| 기록 요약 | Model API | 지출 한 건을 결산보고서에 들어갈 두 문장 이내로 요약합니다 | `lib/agent.ts`의 `finish` |
| 같은 거래 묶기 | Model API (도구 호출) | 카드영수증, 거래명세서, 주문 화면 캡처처럼 한 번 쓴 돈의 서류가 따로 올라오면, 날짜·금액·가맹점·서류 종류를 견줘 같은 거래를 추론하고 한 건으로 합치자고 제안합니다. 가맹점 표기나 날짜가 조금 달라도 찾습니다. 합치는 것은 사람이 누를 때만 됩니다 | `lib/agent.ts`의 `runGroupAgent`, `lib/group.ts` |
| 여러 장 올리기 | Model API, Search API | 영수증 30장까지를 두 장씩 지출 에이전트에 맡겨 초안으로 정리합니다 | `app/app/page.tsx`의 `runBulk` |
| 마감 점검 에이전트 | Model API (도구 호출), Search API | 사업의 기록을 모두 살펴 보완이 필요한 건마다 담당자에게 보낼 요청 문안을 쓰고 브리핑을 만듭니다 | `lib/agent.ts`의 `runCloseAgent` |

호출 방식:

- **Model API**: `POST https://platform.liner.com/api/v1/chat/completions`. 기본 모델은 `liner-gpt-router`이고, 도구 호출을 필수로 겁니다(`tool_choice: "required"`). 영수증 사진은 메시지의 이미지 파트(data URI)로 보냅니다.
- **Search API**: `POST https://platform.liner.com/api/v1/tools/search/web`. 한 번에 8건을 받습니다.
- **키 보호**: `LINER_API_KEY`는 서버에서만 읽고 브라우저로 나가지 않습니다. 테스트가 이를 확인합니다(`tests/proxy.test.ts`).
- **실패 대비**: 429와 5xx는 한 번 다시 시도하고, 30초 안에 응답이 없으면 끊습니다. 어떤 오류든 사용자는 직접 입력으로 계속할 수 있습니다.
- **보내는 것**: 가린 사진, 메모, 기록 값만 보냅니다. 원본 사진은 보내지 않습니다.
- **개인정보 지우기**: 보내기 직전에 글 속의 사람 이름(결제자·제출자·승인자, "○○○ 님" 꼴의 이름)과 주민번호·카드번호·전화번호·계좌번호·메일을 `[사람1]`, `[번호1]` 같은 자리표로 바꾸고, 받은 답에서 원래 값으로 되돌립니다(`lib/privacy.ts`). 모델은 이름을 보지 않고도 "누가 결제했다"를 다룰 수 있습니다. 검색어에서는 자리표까지 뺍니다. PDF는 글자 자리를 읽어 수령인·연락처·주소 같은 곳에 가림 상자를 미리 깔아 줍니다. 사진 속 글자는 자동으로 가리지 못하므로 사용자가 직접 가립니다.

에이전트가 쓰는 도구 전체와 안전장치는 [docs/INTERNALS.md](docs/INTERNALS.md)에 있습니다.

## 쓰는 기술

- 모델과 검색: Liner Model API(도구 호출, 이미지 입력), Liner Search API
- 에이전트와 화면 사이의 통신: [AG-UI 프로토콜](https://docs.ag-ui.com/) 1.0
- 화면: Next.js 15, React 19, Meta의 오픈소스 디자인 시스템 [Astryx](https://github.com/meta/astryx)
- 저장: 기기의 브라우저 저장소. 단체 공간은 기기에서 암호화(AES-GCM)한 뒤 Vercel Blob에 둡니다

## 해커톤 출품 정보

[제1회 라이너 해커톤 · 엑스톤(.EXE-THON)](https://contests.liner.com/hackathon/exe-thon-2611/) 출품작입니다. 주제는 "직접 겪은 업무 문제를 해결하는 AI 에이전트"입니다.

- **개발 기간**: 2026.11.12 ~ 11.25. 이 저장소의 코드는 모두 이 기간에 새로 작성했습니다.
- **Liner API**: 세 에이전트(지출, 마감 점검, 묶음)가 Liner Model API로 동작하고, 공개 지침 검색에 Liner Search API를 씁니다. 위 "Liner API를 사용한 기능" 표에 정리했습니다.
- **데이터**: 화면과 테스트의 단체, 사람, 영수증, 거래명세서는 모두 가상 자료입니다.
- **제출물**: 이 저장소, [시연 영상](https://youtu.be/fnz0AhQ4IRE), 기획서(별도 제출).

## 문서

| 문서 | 내용 |
| --- | --- |
| [docs/USAGE.md](docs/USAGE.md) | 사용법. 처음 시작, 단체 공간, 지출 기록, 검토와 마감, 역할별로 보이는 것, 보고서 공유 |
| [docs/INTERNALS.md](docs/INTERNALS.md) | 에이전트의 도구와 안전장치, AG-UI 연동, 동기화 구조, 서명 원장 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 코드 구조, 자료가 흐르는 길, 지키는 약속, 고칠 때 볼 곳 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 실행과 테스트, 기여할 때 지킬 것 |
| [개발자 안내](https://open-receipt-six.vercel.app/developers) | 다른 서비스에서 에이전트를 부르는 방법과 예제 |

## 저장소 구성

```
app/            화면과 API 경로 (Next.js App Router)
  page.tsx        소개 페이지 (/)
  app/page.tsx    앱 본체 (/app)
  r/, v/          공유받은 결산보고서, 후원자용 보기
  guide/          사용 안내 (역할별 따라 하기)
  developers/     개발자 안내
  api/            에이전트(AG-UI), 단체 공간 동기화, 출시 알림
lib/            규칙과 계산. 화면 없이 테스트할 수 있는 모듈
tests/          단위 테스트 (Vitest)
e2e/            브라우저 흐름 테스트 (Playwright)
public/         아이콘, 가상 영수증, 소개 페이지의 화면 사진
scripts/        아이콘과 가상 영수증 그림 만들기
docs/           사용법, 내부 동작, 구조 안내
video/          시연 영상을 만드는 대본과 코드
wireframes/     개발 초기의 화면 구성 초안 (지금 화면과는 다릅니다)
```

파일마다 첫머리에 그 파일이 하는 일을 적어 두었습니다.

## 테스트

```bash
npm run typecheck   # 형식 검사
npm test            # 단위 테스트 206개. 동기화하는 사이에 적은 기록 지키기, 공간 여러 개와 거래처별 공유, 예산 항목을 목록에서 끌어다 쓰기, 모델로 보내는 글의 개인정보 지우기, 사업 마감, 동기화 주소 호출 제한, 보안 헤더, 오류 보고에서 민감한 것 지우기, 암호로 잠근 단체 공간, 두 기기의 수정을 칸 단위로 합치기, 한 거래로 묶기, 같은 거래 찾기, AG-UI 왕복·이벤트 스키마 검증, 두 기기 동기화, 서명 원장, 공유 링크 등 (Liner는 모의)
npm run test:e2e    # 브라우저 흐름 32개: 시연, 참여해도 기록이 지워지지 않고 합쳐지기, 가만히 열어 둔 기기가 받기, 좁은 화면의 소개 페이지 머리말, 느린 연결에서 동기화 중에 적은 기록, 공간 여러 개와 사업별·거래처별 공유 링크, 사업 마감, 보안 헤더, 오류 화면과 비상 백업, 암호로 잠근 단체 공간, 여러 사람이 올리고 승인·되돌리기, 백업으로 옮기기, 환불·찾기·예산, PDF 서류 올리기, 두 기기가 함께 고치기, 큰 사진 줄여 올리기, 사용 안내, 같은 거래 찾아 합치기, 영수증과 거래명세서 묶기, 첫 방문, 보고서 공유, 두 기기 단체 공간, 후원자용 보기, 서명 원장 등 (에이전트 응답은 모의)
npm run test:live   # 실제 Liner 호출로 전체 흐름. 개발 서버와 LINER_API_KEY, 크레딧 필요
```

배포본을 대상으로 돌리려면 `BASE_URL=https://open-receipt-six.vercel.app`을 앞에 붙입니다.

## 데이터와 한계

- 모든 인물·단체·거래·영수증(`public/demo-receipt.png`)은 시연용 가상 데이터입니다.
- 로그인과 계정이 없습니다. 기록은 각 기기의 브라우저에 저장되고, 단체 공간을 만들면 암호화되어 기기 사이에 맞춰집니다. 승인자만 승인한다는 규칙은 화면 수준이어서, 단체 공간에 참여한 사람은 모든 기록을 읽고 고칠 수 있습니다. 참여할 사람을 좁히려면 단체 공간을 암호로 잠그세요.
- 단체 공간의 서버 저장소는 Vercel Blob입니다. 배포 환경에 Blob 저장소가 연결되어 있어야 동작하고(`BLOB_READ_WRITE_TOKEN`), 로컬 개발에서는 `.data/` 폴더에 저장합니다.
- 공유 링크는 접근 제한이나 만료가 없습니다. 민감한 내용이면 "요약만"과 "이름 가림"으로 공유하세요.
- 이미지 가림은 사용자가 그린 상자로 처리합니다. 이미지 속 개인정보 자동 탐지는 없습니다. 메모의 카드번호·전화번호·주민번호 패턴은 자동으로 가립니다.
- 검색된 지침이 해당 조직에 실제로 적용되는지는 판단하지 않습니다.

## 라이선스

GNU 일반 공중 사용 허가서(GPL) 버전 3 또는 그 이후 버전을 따릅니다. 전문은 `LICENSE`에 있습니다. 누구나 내려받아 쓰고, 고치고, 다시 나눌 수 있으며, 고친 것을 배포할 때는 같은 조건으로 소스를 공개해야 합니다. 보증은 없습니다.

```
열린영수증
Copyright (C) 2026 열린영수증 기여자

이 프로그램은 자유 소프트웨어입니다. 자유 소프트웨어 재단이 발표한 GNU 일반 공중 사용 허가서
버전 3 또는 (선택에 따라) 그 이후 버전의 조건에 따라 재배포하거나 수정할 수 있습니다.
이 프로그램은 유용하게 쓰이기를 바라며 배포하지만 어떠한 보증도 하지 않습니다.
```

소스 파일의 첫 줄에는 `SPDX-License-Identifier: GPL-3.0-or-later`가 있습니다.

이 프로그램이 불러 쓰는 다른 사람의 저작물은 각자의 라이선스를 따릅니다: Next.js(MIT), React(MIT), Astryx(MIT), AG-UI SDK(MIT), `@vercel/blob`(Apache-2.0), PDF.js(`pdfjs-dist`, Apache-2.0. `public/pdfjs/`의 글자 자료 포함).
