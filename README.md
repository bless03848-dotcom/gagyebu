# 우리집 가계부 — 배포 안내

claude.ai 계정 없이 가족 누구나 휴대폰으로 쓰는 가계부입니다.
화면은 GitHub Pages에, 데이터는 Firebase Firestore에 저장합니다.
가족은 처음 한 번만 **가족 코드**와 **이름**을 입력하면 됩니다.

## 파일 구성

| 파일 | 내용 |
|---|---|
| `index.html` | 화면과 디자인 |
| `app.js` | 동작(입력·예산·차트·실시간 동기화) |
| `firebase-config.js` | Firebase 연결 정보 — **직접 채워야 함** |
| `firestore.rules` | 보안 규칙 — Firebase 콘솔에 붙여 넣음 |
| `manifest.webmanifest`, `icons/` | 휴대폰 홈 화면 아이콘 |

## 1단계. Firebase 프로젝트 만들기

1. https://console.firebase.google.com 에 구글 계정으로 로그인합니다.
2. **프로젝트 추가** → 이름(예: `uri-gagyebu`) 입력 → Google 애널리틱스는 꺼도 됩니다.
3. 요금제는 무료(Spark)로 충분합니다.

## 2단계. 웹 앱 등록하고 설정값 넣기

1. 프로젝트 개요 화면에서 **웹(</>) 아이콘**을 눌러 앱을 등록합니다. (Firebase Hosting 체크는 하지 않습니다.)
2. 화면에 나오는 `firebaseConfig = { apiKey: ..., ... }` 값을 복사합니다.
3. `firebase-config.js`를 열어 `여기에_...` 자리에 그대로 붙여 넣고 저장합니다.

> apiKey는 공개되어도 괜찮습니다. 데이터 보호는 4단계의 보안 규칙이 맡습니다.

## 3단계. 익명 로그인 켜기

**Authentication** → **시작하기** → **로그인 방법(Sign-in method)** 탭 → **익명(Anonymous)** → 사용 설정 → 저장

## 4단계. Firestore 만들고 보안 규칙 넣기

1. **Firestore Database** → **데이터베이스 만들기**
   - 위치: `asia-northeast3 (서울)` 권장 (나중에 바꿀 수 없습니다)
   - **프로덕션 모드**로 시작
2. **규칙** 탭에서 기존 내용을 모두 지우고 `firestore.rules` 내용을 붙여 넣은 뒤 **게시**합니다.

## 5단계. 가족 코드 정하기

1. Firestore **데이터** 탭 → **컬렉션 시작**
   - 컬렉션 ID: `config`
   - 문서 ID: `family`
   - 필드: `code` / 유형 `string` / 값: 가족 코드 (예: `poHang-2026!`)
2. 가족 코드는 **8자 이상**, 숫자와 영문을 섞는 것을 권합니다. 이 코드를 아는 사람만 가계부에 들어올 수 있습니다.

## 6단계. GitHub Pages에 올리기

1. https://github.com 에서 **New repository** → 이름(예: `gagyebu`) → **Public** → 만들기
   - 무료 계정의 GitHub Pages는 공개 저장소에서만 됩니다. 저장소에 올라가는 것은 화면 코드뿐이고, 가계부 내역은 Firebase에 있으므로 공개돼도 내역은 보이지 않습니다.
2. **Add file → Upload files**로 이 폴더의 파일을 모두 올립니다. (`icons` 폴더 포함, 폴더 구조 그대로)
3. 저장소 **Settings → Pages** → Source: **Deploy from a branch** → Branch: `main` / `/(root)` → Save
4. 1~2분 뒤 `https://아이디.github.io/gagyebu/` 주소가 생깁니다.

## 7단계. Firebase에 내 주소 허용하기

**Authentication → 설정(Settings) → 승인된 도메인** → **도메인 추가** → `아이디.github.io` 입력

## 8단계. 가족과 함께 쓰기

1. 가족에게 주소와 가족 코드를 알려 줍니다.
2. 각자 휴대폰에서 주소를 열고 가족 코드와 이름(예: 아빠, 엄마)을 입력합니다.
3. 홈 화면에 추가하면 앱처럼 쓸 수 있습니다.
   - 아이폰(Safari): 공유 버튼 → **홈 화면에 추가**
   - 안드로이드(Chrome): 메뉴(⋮) → **홈 화면에 추가** 또는 **앱 설치**

## 운영 팁

- **가족 코드를 바꾸려면**: `config/family`의 `code` 값을 바꿉니다. 이미 들어온 기기는 계속 쓸 수 있고, 새 기기만 새 코드가 필요합니다.
- **특정 기기를 내보내려면**: Firestore 데이터 탭의 `members` 컬렉션에서 그 기기의 문서를 삭제합니다. (문서 안의 `name`으로 누구인지 확인)
- **모두 내보내고 새로 시작하려면**: 가족 코드를 바꾼 뒤 `members` 문서를 모두 삭제합니다.
- **인터넷이 끊겨도** 입력은 휴대폰에 먼저 저장되고, 연결되면 자동으로 올라갑니다.
- **브라우저 데이터를 지우면** 그 기기는 가족 코드를 다시 입력해야 합니다. 내역은 그대로 남아 있습니다.
- **화면을 고치면** 바뀐 파일만 GitHub에 다시 올리면 1~2분 뒤 반영됩니다. 반영이 안 보이면 새로고침하세요.

## 데이터 구조 (참고)

- `entries/{자동ID}`: `date`, `month`, `type`(income/expense), `amount`, `category`, `memo`, `by`(기기 ID), `createdAt`, `updatedAt`
- `budgets/{YYYY-MM}`: `amount`, `by`, `updatedAt` — 해당 달에 예산이 없으면 가장 최근 달의 예산을 이어서 씀
- `members/{기기 ID}`: `name`, `code`, `joinedAt`
- `config/family`: `code` — 콘솔에서만 관리
