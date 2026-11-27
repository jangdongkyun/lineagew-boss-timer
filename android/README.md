# LINEAGE W 보탐봇 안드로이드 플로팅 앱

기존 GitHub Pages 보탐봇을 그대로 표시하는 Android WebView 앱입니다. 메인 웹사이트와 Supabase 데이터 구조는 수정하지 않습니다.

## 동작
- 앱 실행 시 기존 보탐봇 메인 화면을 엽니다.
- 메인 화면의 작은 팝업 열기 버튼을 누르면 Android의 '다른 앱 위에 표시' 권한을 요청합니다.
- 권한을 허용하면 mini.html을 작은 플로팅 창으로 표시합니다.
- 상단 바를 드래그해 위치를 옮기고, 메인 또는 닫기 버튼으로 복귀/닫기를 할 수 있습니다.

## APK 만들기
GitHub Actions의 Android APK build 워크플로를 실행하면 boss-timer-android-debug-apk 아티팩트로 디버그 APK가 생성됩니다.

Android Studio에서 android 폴더를 열어 직접 빌드할 수도 있습니다.
